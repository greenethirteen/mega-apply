// scripts/smoke-email.js
import { load } from 'cheerio';
import { extractEmails } from '../src/email/extract.js';

const html = `
<a href='mailto:sarfraz@goldenflagksa.com' class="btn btn-success">Apply Now</a>
<p><b>Email :</b>&nbsp;sarfraz@goldenflagksa.com</p>
`;

const $ = load(html);
const emails = extractEmails(html, $);
console.log('FOUND:', emails);
