import axios from 'axios';
import * as cheerio from 'cheerio';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

async function main() {
  // Grab the listing page and pull one event URL
  const listing = await axios.get('https://www.westword.com/things-to-do', { headers: HEADERS, timeout: 15000 });
  const $ = cheerio.load(listing.data);

  const links = new Set<string>();
  $('a[href*="/event/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const full = href.startsWith('http') ? href : `https://www.westword.com${href}`;
    links.add(full.split('?')[0]);
  });

  console.log(`Found ${links.size} event links on /things-to-do`);
  const eventUrls = [...links].slice(0, 3);
  console.log('Sample URLs:', eventUrls);

  const url = eventUrls[0];
  console.log('\n' + '='.repeat(60));
  console.log('Inspecting:', url);

  const page = await axios.get(url, { headers: HEADERS, timeout: 10000 });
  const p$ = cheerio.load(page.data);

  // Print page title
  console.log('\nPage <title>:', p$('title').text().trim());

  // Print all meta tags (og:, event data often here)
  console.log('\n── Meta tags ──');
  p$('meta').each((_, el) => {
    const name = p$(el).attr('name') || p$(el).attr('property') || p$(el).attr('itemprop');
    const content = p$(el).attr('content');
    if (name && content) console.log(`  ${name}: ${content}`);
  });

  // Print all data-* attributes on any element (often carry structured data)
  console.log('\n── Elements with class names containing "event" ──');
  p$('[class*="event"], [class*="Event"]').each((_, el) => {
    const classes = p$(el).attr('class');
    const text = p$(el).text().trim().slice(0, 150);
    if (text) console.log(`  .${classes?.split(' ')[0]}: ${text}`);
  });

  // Look for date/time patterns anywhere in text
  console.log('\n── Elements containing date/time text ──');
  const datePattern = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}/i;
  const timePattern = /\d{1,2}:\d{2}\s*(am|pm)/i;
  p$('*').each((_, el) => {
    const text = p$(el).clone().children().remove().end().text().trim();
    if (text && (datePattern.test(text) || timePattern.test(text)) && text.length < 200) {
      const tag = el.type === 'tag' ? el.name : 'unknown';
      const cls = p$(el).attr('class')?.split(' ')[0] ?? '';
      console.log(`  <${tag} class="${cls}">: ${text}`);
    }
  });

  // Print the raw HTML of the main content area
  console.log('\n── First 3000 chars of <main> or <article> ──');
  const mainHtml = p$('main, article, [role="main"]').first().html() ?? p$('body').html() ?? '';
  console.log(mainHtml.slice(0, 3000));
}

main().catch(err => { console.error(err); process.exit(1); });
