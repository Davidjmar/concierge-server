/**
 * Quick smoke test for the Westword scraper.
 * Run with: npx tsx src/scripts/testWestword.ts
 *
 * Does NOT write to the database — just fetches and prints results
 * so you can verify the structured data is being extracted correctly.
 */

import { Scraper } from '../services/scraper.js';

async function main() {
  const scraper = new Scraper();

  console.log('─'.repeat(60));
  console.log('Westword scraper test');
  console.log('─'.repeat(60));

  const events = await scraper.scrapeWestword();

  if (events.length === 0) {
    console.log('⚠  No events returned. Check network access and selectors.');
    process.exit(1);
  }

  // Separate structured (JSON-LD) events from RSS items
  const structured = events.filter(e => e.location?.address !== 'Denver, CO');
  const rss = events.filter(e => e.location?.address === 'Denver, CO');

  console.log(`\nTotal: ${events.length}  |  Structured (JSON-LD): ${structured.length}  |  RSS (food/drink): ${rss.length}\n`);

  // Print structured events in full
  console.log('─'.repeat(60));
  console.log('STRUCTURED EVENTS (from event pages)');
  console.log('─'.repeat(60));

  structured.forEach((e, i) => {
    const start = e.datetime?.start instanceof Date
      ? e.datetime.start.toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' })
      : String(e.datetime?.start);
    const end = e.datetime?.end instanceof Date
      ? e.datetime.end.toLocaleString('en-US', { timeZone: 'America/Denver', timeStyle: 'short' })
      : String(e.datetime?.end);

    console.log(`\n${i + 1}. ${e.title}`);
    console.log(`   Type    : ${e.type}`);
    console.log(`   When    : ${start} – ${end}`);
    console.log(`   Venue   : ${e.venueName ?? '(not in data)'}`);
    console.log(`   Address : ${e.location?.address}`);
    console.log(`   Coords  : [${e.location?.coordinates.map(n => n.toFixed(4)).join(', ')}]`);
    console.log(`   Price   : $${e.price?.min}–$${e.price?.max}`);
    console.log(`   Tags    : ${e.tags?.join(', ')}`);
    console.log(`   URL     : ${e.sourceUrl}`);
    if (e.description) {
      console.log(`   Desc    : ${e.description.slice(0, 120)}${e.description.length > 120 ? '…' : ''}`);
    }
  });

  // Summary stats
  console.log('\n' + '─'.repeat(60));
  console.log('SUMMARY STATS');
  console.log('─'.repeat(60));

  const withVenue = structured.filter(e => e.venueName).length;
  const withAddress = structured.filter(e => e.location?.address && e.location.address !== 'Denver, CO').length;
  const withPrice = structured.filter(e => (e.price?.max ?? 0) > 0).length;
  const withCoords = structured.filter(e => {
    const [lng, lat] = e.location?.coordinates ?? [0, 0];
    return !(Math.abs(lng - (-104.9847)) < 0.001 && Math.abs(lat - 39.7392) < 0.001);
  }).length;

  console.log(`Structured events with venue name : ${withVenue}/${structured.length}`);
  console.log(`Structured events with address    : ${withAddress}/${structured.length}`);
  console.log(`Structured events geocoded        : ${withCoords}/${structured.length}`);
  console.log(`Structured events with price data : ${withPrice}/${structured.length}`);

  const typeCounts: Record<string, number> = {};
  events.forEach(e => { typeCounts[e.type ?? 'unknown'] = (typeCounts[e.type ?? 'unknown'] ?? 0) + 1; });
  console.log('\nEvent type breakdown:');
  Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    console.log(`  ${t.padEnd(12)} ${n}`);
  });

  console.log('\n✓ Test complete');
  process.exit(0);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
