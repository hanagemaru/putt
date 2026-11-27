import { writeFile } from 'node:fs/promises';
const url = new URL('https://putt.hanage.app/');
url.searchParams.set('utm_source', 'x');
url.searchParams.set('utm_medium', 'organic_social');
url.searchParams.set('utm_campaign', 'first_play');
url.searchParams.set('utm_content', 'putt_cup_in');
const text = `傾斜を読んで、スワイプで打つパッティングゲームを作っています。\nスマホのブラウザで無料で遊べます。\n\n動画はゲーム内の物理を使った自動プレイです。\n${url}\n`;
await writeFile('social-post.txt', text);
console.log(text);
