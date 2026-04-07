import Anthropic from '@anthropic-ai/sdk';
import Event from '../models/event.js';
import { Op } from 'sequelize';

// All valid tags the system understands. The LLM must only return tags from this list.
export const VALID_TAGS = [
  // Activity type
  'happy_hour', 'live_music', 'concert', 'comedy', 'trivia', 'film', 'art',
  'market', 'festival', 'sports', 'class', 'lecture', 'tour', 'yoga', 'fitness',
  'hiking', 'cycling', 'running', 'climbing', 'dance', 'theater', 'open_mic',
  // Vibe
  'chill', 'lively', 'date_night', 'social', 'family_friendly', 'networking',
  'intimate', 'rowdy', 'classy', 'dive_bar',
  // Setting
  'outdoor', 'indoor', 'rooftop', 'patio', 'park',
  // Food & drink
  'craft_beer', 'cocktails', 'wine', 'coffee', 'food_trucks', 'brunch',
  'vegetarian', 'vegan', 'gluten_free',
  // Price
  'free', 'cheap',
  // Demographic
  'dog_friendly', 'lgbtq', 'solo_friendly',
  // Time of day
  'morning', 'afternoon', 'evening', 'late_night',
  // Activity level
  'active', 'low_key',
  // Special
  'seasonal', 'recurring', 'new', 'local',
];

const SYSTEM_PROMPT = `You are a Denver event tagger. Given an event's title, description, and venue name, return a JSON array of relevant tags from the approved list only.

Approved tags: ${VALID_TAGS.join(', ')}

Rules:
- Return ONLY a JSON array of strings, no explanation
- Only use tags from the approved list
- Choose 3–8 tags that best capture what the event actually is
- Infer from context: "bike ride" → cycling, active, outdoor; "tasting room" → craft_beer or wine; "sunset" → outdoor, evening
- Be specific: prefer "craft_beer" over generic "bar", "yoga" over "fitness" when clear
- Do NOT include tags that aren't clearly supported by the event details`;

class TagEnrichmentService {
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not set — tag enrichment disabled');
      }
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return this.client;
  }

  /**
   * Enriches a single event's tags using Claude Haiku.
   * Merges LLM-suggested tags with any existing scraper tags.
   * Returns the merged tag array.
   */
  async enrichEventTags(event: {
    title: string;
    description?: string | null;
    venue_name?: string | null;
    tags?: string[];
  }): Promise<string[]> {
    const client = this.getClient();

    const userMessage = [
      `Title: ${event.title}`,
      event.venue_name ? `Venue: ${event.venue_name}` : '',
      event.description ? `Description: ${event.description.slice(0, 500)}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = (msg.content[0] as any)?.text ?? '';
    let llmTags: string[] = [];

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        llmTags = parsed.filter((t): t is string => VALID_TAGS.includes(t));
      }
    } catch {
      // Haiku occasionally returns tags with surrounding text — try to extract array
      const match = text.match(/\[.*\]/s);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            llmTags = parsed.filter((t): t is string => VALID_TAGS.includes(t));
          }
        } catch { /* give up, return existing tags */ }
      }
    }

    // Merge with existing scraper-assigned tags (deduplicate)
    const existing = event.tags ?? [];
    return [...new Set([...existing, ...llmTags])];
  }

  /**
   * Batch-enriches all active events that have fewer than 2 tags.
   * Safe to run on a schedule — won't re-process already-enriched events.
   * Returns counts: { enriched, skipped, errors }
   */
  async enrichSparseEvents(): Promise<{ enriched: number; skipped: number; errors: number }> {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('[TagEnrichment] Skipped — ANTHROPIC_API_KEY not set');
      return { enriched: 0, skipped: 0, errors: 0 };
    }

    // Find active events with 0 or 1 tags
    const sparse = await Event.findAll({
      where: {
        is_active: true,
        [Op.or]: [
          { tags: null },
          { tags: [] },
          // Sequelize JSON array length check — filter in JS for portability
        ],
      },
      limit: 200, // process at most 200 per run to control cost
    });

    // Also pick up events with exactly 1 tag (likely just source-assigned)
    const toEnrich = sparse.filter(e => {
      const t = (e.tags as string[]) ?? [];
      return t.length < 2;
    });

    console.log(`[TagEnrichment] Enriching ${toEnrich.length} sparse events`);

    let enriched = 0, skipped = 0, errors = 0;

    for (const event of toEnrich) {
      try {
        const mergedTags = await this.enrichEventTags({
          title: event.title,
          description: event.description ?? undefined,
          venue_name: (event as any).venue_name ?? undefined,
          tags: (event.tags as string[]) ?? [],
        });

        if (mergedTags.length > ((event.tags as string[]) ?? []).length) {
          await event.update({ tags: mergedTags });
          enriched++;
        } else {
          skipped++;
        }

        // ~2 req/s to stay within Haiku's rate limits
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error(`[TagEnrichment] Error on event ${event.id} "${event.title}":`, err);
        errors++;
      }
    }

    console.log(`[TagEnrichment] Done — enriched: ${enriched}, skipped: ${skipped}, errors: ${errors}`);
    return { enriched, skipped, errors };
  }
}

export default new TagEnrichmentService();
