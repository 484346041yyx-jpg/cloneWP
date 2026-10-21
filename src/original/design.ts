import type { OriginalDesign, OriginalNode } from './types.js';

const C = { ivory: '#F8F5EE', white: '#FFFFFF', forest: '#234A3E', ink: '#263D33', muted: '#617169', clay: '#A94833', sage: '#E5EBDD', sand: '#EDE4D6', line: '#D8DDD2' };
const text = (key: string, value: string, style: OriginalNode['style'] = {}): OriginalNode => ({ key, kind: 'text', text: value, style: { fontSize: 17, mobileFontSize: 16, lineHeight: 1.65, color: C.muted, ...style } });
const heading = (key: string, value: string, size = 42, style: OriginalNode['style'] = {}, headingTag: 'h1' | 'h2' | 'h3' | 'p' = 'h2'): OriginalNode => ({ key, kind: 'heading', headingTag, text: value, style: { fontSize: size, mobileFontSize: size > 36 ? 34 : size, weight: 700, lineHeight: 1.12, color: C.forest, ...style } });
const label = (key: string, value: string, color = C.clay): OriginalNode => text(key, value, { fontSize: 12, mobileFontSize: 12, weight: 700, color, lineHeight: 1.5 });
const button = (key: string, value: string, href: string, secondary = false): OriginalNode => ({ key, kind: 'button', text: value, href, style: { background: secondary ? C.white : C.forest, color: secondary ? C.forest : C.white, borderWidth: 1, borderColor: C.forest, radius: 5, padding: [15, 23, 15, 23], fontSize: 14, weight: 700, lineHeight: 1.3 } });
const box = (key: string, children: OriginalNode[], style: OriginalNode['style'] = {}, anchor?: string): OriginalNode => ({ key, kind: 'container', children, anchor, style: { direction: 'column', gap: 20, ...style } });
const section = (key: string, children: OriginalNode[], background: string, anchor?: string, style: OriginalNode['style'] = {}): OriginalNode => box(key, children, { boxed: true, background, padding: [84, 28, 84, 28], mobilePadding: [52, 22, 52, 22], ...style }, anchor);
const intro = (key: string, eyebrow: string, title: string, description?: string, centered = true): OriginalNode => box(key, [label(`${key}-eyebrow`, eyebrow), heading(`${key}-title`, title), ...(description ? [text(`${key}-description`, description)] : [])], { gap: 13, align: centered ? 'center' : 'left', alignItems: centered ? 'center' : 'flex-start', margin: [0, 0, 28, 0] });

export const originalDesign: OriginalDesign = {
  version: 1,
  brand: 'MoriPaws',
  title: 'MoriPaws — Everyday care, closer together',
  language: 'en',
  description: 'An original pet-care demonstration homepage for calm, thoughtful daily routines. No ecommerce, appointment or newsletter backend is represented.',
  tokens: { colors: C, font: 'Arial', contentWidth: 1200 },
  assets: [
    { key: 'hero', path: 'D:/cloneWP/original/assets/hero-pets.png', alt: 'A golden dog and grey tabby cat relaxing together in a sunlit home', provenance: 'Original AI-generated editorial photograph created with the built-in image_gen tool; prompt and generated file are recorded in original/assets/generation-record.json.' },
    { key: 'care', path: 'D:/cloneWP/original/assets/care-lifestyle.png', alt: 'A golden dog gently brushed at home while a tabby cat watches nearby', provenance: 'Original AI-generated lifestyle photograph created with the built-in image_gen tool; prompt and generated file are recorded in original/assets/generation-record.json.' },
  ],
  sections: [
    section('header', [
      heading('brand-wordmark', 'MoriPaws', 30, { mobileFontSize: 30, lineHeight: 1 }, 'p'),
      box('main-navigation', [
        { key: 'nav-care', kind: 'button', text: 'Daily care', href: '#daily-care', style: { background: C.ivory, color: C.forest, fontSize: 13, padding: [10, 4, 10, 4], radius: 0 } },
        { key: 'nav-story', kind: 'button', text: 'Our approach', href: '#our-approach', style: { background: C.ivory, color: C.forest, fontSize: 13, padding: [10, 4, 10, 4], radius: 0 } },
        { key: 'nav-faq', kind: 'button', text: 'FAQs', href: '#questions', style: { background: C.ivory, color: C.forest, fontSize: 13, padding: [10, 4, 10, 4], radius: 0 } },
      ], { direction: 'row', mobileDirection: 'row', gap: 23, justify: 'center', alignItems: 'center' }),
      button('nav-start', 'Find your rhythm', '#care-routine'),
    ], C.ivory, 'top', { direction: 'row', mobileDirection: 'column', justify: 'space-between', alignItems: 'center', gap: 18, padding: [27, 28, 27, 28], mobilePadding: [22, 22, 22, 22], borderColor: C.line, borderWidth: 0 }),

    section('hero', [
      box('hero-copy', [
        label('hero-eyebrow', 'GOOD DAYS START WITH LITTLE THINGS'),
        heading('hero-title', 'Everyday care.\nExtraordinary company.', 62, { mobileFontSize: 44, lineHeight: 1.06 }, 'h1'),
        text('hero-description', 'For the paws that follow you everywhere. Make room for gentle routines, curious play and a little more time together.', { fontSize: 18, mobileFontSize: 17, color: C.muted }),
        box('hero-actions', [button('hero-primary', 'Explore daily care', '#daily-care'), button('hero-secondary', 'Meet our approach', '#our-approach', true)], { direction: 'row', mobileDirection: 'column', gap: 12, alignItems: 'flex-start', margin: [8, 0, 0, 0] }),
        text('hero-note', 'Thoughtful routines for dogs, cats and the people who love them.', { fontSize: 13, mobileFontSize: 13, color: C.muted, margin: [8, 0, 0, 0] }),
      ], { width: 46, mobileWidth: 100, gap: 23, justify: 'center' }),
      box('hero-visual', [
        { key: 'hero-image', kind: 'image', asset: 'hero', alt: 'A golden dog and grey tabby cat relaxing together in a sunlit home', style: { width: 100, imageHeight: 490, mobileImageHeight: 320, radius: 22 } },
        box('hero-image-caption', [label('hero-caption-label', 'MORE THAN A ROUTINE', C.forest), text('hero-caption-text', 'A small moment. A stronger bond.', { fontSize: 15, color: C.forest })], { padding: [17, 20, 17, 20], background: C.sage, radius: 12, gap: 4 }),
      ], { width: 48, mobileWidth: 100, gap: 14 }),
    ], C.ivory, 'welcome', { direction: 'row', mobileDirection: 'column', justify: 'space-between', alignItems: 'center', gap: 40, padding: [35, 28, 70, 28], mobilePadding: [28, 22, 48, 22] }),

    section('daily-care', [
      intro('care-intro', 'A LITTLE CARE, EVERY DAY', 'Made for your everyday.', 'Start with the moments you already share. Keep them simple, comfortable and consistent.'),
      box('care-cards', [
        box('gentle-care-card', [label('gentle-care-number', '01 / GENTLE CARE'), heading('gentle-care-title', 'A softer start.', 28, {}, 'h3'), text('gentle-care-copy', 'Brushing, a quiet pause and a comfortable space. Build a grooming routine around your pet’s pace.'), button('gentle-care-link', 'Find a calm routine', '#care-routine', true)], { width: 31, mobileWidth: 100, background: C.sage, padding: [32, 28, 32, 28], radius: 12, gap: 20 }),
        box('daily-play-card', [label('daily-play-number', '02 / EVERYDAY PLAY'), heading('daily-play-title', 'Follow their curiosity.', 28, {}, 'h3'), text('daily-play-copy', 'Make space for sniffing, exploring and short play sessions. Notice what brings out their playful side.'), button('daily-play-link', 'Explore playful moments', '#care-notes', true)], { width: 31, mobileWidth: 100, background: C.sand, padding: [32, 28, 32, 28], radius: 12, gap: 20 }),
        box('home-comfort-card', [label('home-comfort-number', '03 / HOME COMFORT'), heading('home-comfort-title', 'Their own little haven.', 28, {}, 'h3'), text('home-comfort-copy', 'A familiar resting spot and easy access to fresh water make everyday spaces feel welcoming.'), button('home-comfort-link', 'Read our care notes', '#care-notes', true)], { width: 31, mobileWidth: 100, background: '#F0E3DC', padding: [32, 28, 32, 28], radius: 12, gap: 20 }),
      ], { direction: 'row', mobileDirection: 'column', justify: 'space-between', alignItems: 'stretch', gap: 24 }),
    ], C.white, 'daily-care'),

    section('our-approach', [
      { key: 'story-image', kind: 'image', asset: 'care', alt: 'A golden dog gently brushed at home while a tabby cat watches nearby', style: { width: 47, mobileWidth: 100, imageHeight: 460, mobileImageHeight: 300, radius: 20 } },
      box('story-copy', [
        label('story-eyebrow', 'THE MORIPAWS APPROACH'),
        heading('story-title', 'Care starts with\ngetting to know them.', 44, { mobileFontSize: 35 }),
        text('story-description', 'There is no one-size-fits-all day. A lively puppy, a watchful cat and an older companion each have their own rhythm.'),
        text('story-second-paragraph', 'MoriPaws is a pet-care concept built around a simple idea: pay attention, keep everyday routines gentle, and enjoy the company along the way.'),
        box('story-values', [label('story-value-one', 'NOTICE THE LITTLE THINGS', C.forest), text('story-value-copy', 'Comfort, curiosity and a routine that fits your pet.', { fontSize: 15, color: C.forest })], { background: C.sage, padding: [18, 22, 18, 22], radius: 8, gap: 6 }),
        button('story-link', 'Build your daily rhythm', '#care-routine'),
      ], { width: 46, mobileWidth: 100, gap: 21, alignItems: 'flex-start' }),
    ], C.ivory, 'our-approach', { direction: 'row', mobileDirection: 'column', justify: 'space-between', alignItems: 'center', gap: 42 }),

    section('care-routine', [
      intro('routine-intro', 'SMALL STEPS. SHARED MOMENTS.', 'Find a rhythm that feels right.', 'A simple starting point for everyday care. Adjust it to your pet, your home and your day.'),
      box('routine-steps', [
        box('step-observe', [heading('observe-number', '01', 42, { color: C.clay }, 'p'), heading('observe-title', 'Notice.', 25, {}, 'h3'), text('observe-copy', 'Watch how your pet responds. A relaxed posture or a little hesitation can help you decide when to continue or pause.')], { width: 31, mobileWidth: 100, gap: 14, padding: [26, 22, 26, 22], borderColor: C.line, borderWidth: 1, radius: 10 }),
        box('step-connect', [heading('connect-number', '02', 42, { color: C.clay }, 'p'), heading('connect-title', 'Make time.', 25, {}, 'h3'), text('connect-copy', 'Choose a short moment for play, brushing or quiet company. Small, familiar routines can be easier to keep.')], { width: 31, mobileWidth: 100, gap: 14, padding: [26, 22, 26, 22], borderColor: C.line, borderWidth: 1, radius: 10 }),
        box('step-repeat', [heading('repeat-number', '03', 42, { color: C.clay }, 'p'), heading('repeat-title', 'Keep it gentle.', 25, {}, 'h3'), text('repeat-copy', 'Give them space to step away. Change the pace when needed, and ask your vet for advice about individual care needs.')], { width: 31, mobileWidth: 100, gap: 14, padding: [26, 22, 26, 22], borderColor: C.line, borderWidth: 1, radius: 10 }),
      ], { direction: 'row', mobileDirection: 'column', justify: 'space-between', gap: 24 }),
    ], C.white, 'care-routine'),

    section('care-notes', [
      intro('notes-intro', 'NOTES FOR LIFE TOGETHER', 'Good habits, little by little.', 'Three gentle reminders to bring into your next shared moment.'),
      box('notes-grid', [
        box('note-grooming', [label('note-grooming-label', 'GROOMING / START SLOW'), heading('note-grooming-title', 'Let them set the pace.', 27, {}, 'h3'), text('note-grooming-copy', 'Introduce a brush briefly, let your pet investigate it, and keep the first session short. Stop if they seem uncomfortable.'), text('note-grooming-footer', 'Calm beginnings matter.', { color: C.forest, fontSize: 14, weight: 700 })], { width: 31, mobileWidth: 100, padding: [30, 27, 30, 27], background: C.ivory, radius: 12, gap: 20 }),
        box('note-play', [label('note-play-label', 'PLAY / STAY PRESENT'), heading('note-play-title', 'Give play your attention.', 27, {}, 'h3'), text('note-play-copy', 'Choose toys suited to your pet’s size and supervise play. Check regularly for damage and put broken toys aside.'), text('note-play-footer', 'A little curiosity goes a long way.', { color: C.forest, fontSize: 14, weight: 700 })], { width: 31, mobileWidth: 100, padding: [30, 27, 30, 27], background: C.ivory, radius: 12, gap: 20 }),
        box('note-rest', [label('note-rest-label', 'REST / MAKE ROOM'), heading('note-rest-title', 'Let quiet be part of the day.', 27, {}, 'h3'), text('note-rest-copy', 'Create a resting place away from busy foot traffic. Let your pet choose when to join in and when to take a break.'), text('note-rest-footer', 'Comfort can be beautifully simple.', { color: C.forest, fontSize: 14, weight: 700 })], { width: 31, mobileWidth: 100, padding: [30, 27, 30, 27], background: C.ivory, radius: 12, gap: 20 }),
      ], { direction: 'row', mobileDirection: 'column', justify: 'space-between', alignItems: 'stretch', gap: 24 }),
    ], C.sage, 'care-notes'),

    section('questions', [
      box('faq-intro', [label('faq-eyebrow', 'A FEW THINGS TO KNOW'), heading('faq-title', 'Small questions.\nThoughtful answers.', 42, { mobileFontSize: 34 }), text('faq-description', 'A little context before you settle into your routine.')], { width: 35, mobileWidth: 100, gap: 18 }),
      { key: 'care-faq', kind: 'accordion', items: [
        { title: 'Is MoriPaws a real pet-care business?', content: 'MoriPaws is an original demonstration brand. This homepage shows a pet-care design concept; it does not offer real products, appointments or subscriptions.' },
        { title: 'Is this advice suitable for every pet?', content: 'Every pet is different. These notes are general everyday-care ideas, not a substitute for veterinary advice. Ask your veterinarian about your pet’s individual needs.' },
        { title: 'How do I start a new routine?', content: 'Begin with a brief, calm moment and watch your pet’s response. Keep the experience comfortable, allow them to step away, and adjust the pace as needed.' },
        { title: 'Where can I find the everyday care notes?', content: 'Use Care notes in the footer, or Explore daily care at the top of the page. Both links take you directly to the relevant section on this homepage.' },
      ], style: { width: 59, mobileWidth: 100, fontSize: 17, mobileFontSize: 16, lineHeight: 1.65, color: C.forest, borderColor: C.line, borderWidth: 1, radius: 8 } },
    ], C.ivory, 'questions', { direction: 'row', mobileDirection: 'column', justify: 'space-between', alignItems: 'flex-start', gap: 44 }),

    section('closer-together', [
      label('closing-eyebrow', 'FOR THE EVERYDAY, AND EVERY PAW', '#E6B59E'),
      heading('closing-title', 'Make a little more\nroom for together.', 52, { mobileFontSize: 38, color: C.white, align: 'center' }),
      text('closing-copy', 'Start with one small moment. Follow their curiosity. Enjoy the company.', { color: '#E2EADD', fontSize: 18, align: 'center' }),
      { key: 'closing-button', kind: 'button', text: 'Find your daily rhythm', href: '#care-routine', style: { background: C.ivory, color: C.forest, radius: 5, padding: [17, 26, 17, 26], fontSize: 14, weight: 700, margin: [8, 0, 0, 0] } },
    ], C.forest, 'closer-together', { align: 'center', alignItems: 'center', gap: 22, padding: [76, 28, 76, 28], mobilePadding: [56, 22, 56, 22] }),

    section('footer', [
      box('footer-main', [
        box('footer-brand', [heading('footer-wordmark', 'MoriPaws', 30, {}, 'p'), text('footer-description', 'Everyday care, closer together.', { fontSize: 15, color: C.muted })], { gap: 10 }),
        box('footer-navigation', [
          { key: 'footer-care', kind: 'button', text: 'Daily care', href: '#daily-care', style: { background: C.ivory, color: C.forest, fontSize: 13, padding: [8, 0, 8, 0] } },
          { key: 'footer-notes', kind: 'button', text: 'Care notes', href: '#care-notes', style: { background: C.ivory, color: C.forest, fontSize: 13, padding: [8, 0, 8, 0] } },
          { key: 'footer-faq', kind: 'button', text: 'FAQs', href: '#questions', style: { background: C.ivory, color: C.forest, fontSize: 13, padding: [8, 0, 8, 0] } },
          { key: 'footer-top', kind: 'button', text: 'Back to top ↑', href: '#top', style: { background: C.ivory, color: C.forest, fontSize: 13, padding: [8, 0, 8, 0] } },
        ], { direction: 'row', mobileDirection: 'column', gap: 24, justify: 'center', alignItems: 'center' }),
      ], { direction: 'row', mobileDirection: 'column', justify: 'space-between', alignItems: 'center', gap: 24 }),
      text('footer-demo-note', 'MoriPaws is a demonstration brand. Original design and AI-generated photography. No products, appointments or subscriptions are offered on this page.', { fontSize: 12, mobileFontSize: 12, color: C.muted, lineHeight: 1.6, margin: [20, 0, 0, 0] }),
    ], C.ivory, 'footer', { padding: [42, 28, 30, 28], mobilePadding: [34, 22, 28, 22], gap: 20 }),
  ],
};
