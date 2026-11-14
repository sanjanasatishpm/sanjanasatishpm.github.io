// Frequently asked questions. Each answer is a list of paragraphs.
// Keep these in step with how the app actually behaves.
import { h } from './ui.js';

const SECTIONS = [
  {
    title: 'Getting started',
    items: [
      ['What is FlowState?', [
        'A class planner and live timer for fitness instructors. Build a class from timed segments and breaks, check it fits your class length, then press Start and teach from a countdown you can read from across the room.',
      ]],
      ['Who is it for?', [
        'Instructors of any discipline: Pilates, yoga, strength, barre, cycling, HIIT and more. If yours isn’t listed, choose Other and type your own, such as Boxing.',
      ]],
      ['Do I need an account?', [
        'No. As a guest you can build a class, save each segment and run it. Guest classes aren’t kept, so when you leave or close the page, the class is gone.',
        'Create a free account to keep your programs and use them on all your devices.',
      ]],
      ['Is FlowState free?', [
        'Yes. Accounts are free.',
      ]],
    ],
  },
  {
    title: 'Building a class',
    items: [
      ['How do I build a class?', [
        'Tap New program, or Build your first class. Give it a name, a class type and a class length. Then add segments with New and rests with New break, each with a name, a duration and optional notes.',
      ]],
      ['How do I know if my class fits the time?', [
        'The timing bar at the top adds up your segments and breaks as you go, and shows how much time is left or how far over you are.',
      ]],
      ['How do I change the order?', [
        'Drag a segment by its handle, on a laptop or a touchscreen. You can also use the move up and move down buttons.',
      ]],
      ['Can I reuse a class?', [
        'Yes. Duplicate any program from your list, then change the copy.',
      ]],
      ['I deleted something by mistake. Can I get it back?', [
        'Right after you delete it, tap Undo in the message at the bottom of the screen. Signed-in instructors can undo a deleted program or segment. Guests can undo a deleted segment.',
      ]],
      ['Can I add music cues?', [
        'Not yet. Music cues are planned for a later version.',
      ]],
    ],
  },
  {
    title: 'Running a class',
    items: [
      ['What do I see when I press Start?', [
        'A large countdown for the current segment, the time left in the whole class, the segment’s notes and what’s coming next.',
      ]],
      ['What controls do I have during class?', [
        'Play and pause, skip forward, go back, and add 30 seconds to the current segment. Stop asks you to confirm first, so a stray tap won’t end your class.',
      ]],
      ['How do the alerts work?', [
        'Ten seconds before a segment ends, FlowState beeps and the screen changes. It plays a different sound when the next segment starts. Use Test the sound before you start to check your volume.',
        'Phones that support it also vibrate. iPhones don’t let websites vibrate.',
      ]],
      ['I can’t hear the alerts. What should I check?', [
        'Turn up your volume, and on an iPhone, turn off silent mode. Your browser only allows sound after you tap something, so start each class with the Start button.',
      ]],
      ['Will my screen stay on?', [
        'FlowState asks your browser to keep the screen on during class. If your browser can’t, you’ll see a note asking you to keep it on yourself.',
      ]],
      ['What if my phone locks or I switch apps?', [
        'The timer keeps the correct time and catches up when you come back. Alerts may not sound while the screen is locked or another app is open, so keep FlowState on screen while you teach.',
      ]],
      ['Can I edit my class while it’s running?', [
        'No. Editing is locked during class so nothing changes by accident. Stop the class to make changes.',
      ]],
      ['What happens if I close the page mid-class?', [
        'If you’re signed in, the class comes back paused where you left off. Guest classes aren’t kept.',
      ]],
    ],
  },
  {
    title: 'Accounts and saving',
    items: [
      ['How do I sign up?', [
        'Tap Sign up or sign in and use your email with a password of at least 8 characters, or continue with Google.',
      ]],
      ['I built a class as a guest. Can I keep it?', [
        'Yes, if you create an account before you leave. The class you’re working on moves into your new account.',
      ]],
      ['Do my programs sync between devices?', [
        'Yes. Sign in on each device and your programs follow you. Changes save automatically. If you edit the same program on two devices at once, the most recent save wins.',
      ]],
      ['I forgot my password.', [
        'On the sign-in screen, tap Forgot your password? and we’ll email you a link to reset it.',
      ]],
      ['Can I back up my programs?', [
        'Yes. When you’re signed in, use Export programs at the bottom of your program list to save a copy as a file. Use Import programs to bring it back.',
      ]],
      ['How do I delete my account?', [
        'Go to Account, then Delete account. This permanently deletes your account and every program in it, on all your devices. It can’t be undone.',
      ]],
    ],
  },
  {
    title: 'Phones and offline use',
    items: [
      ['Is there an app in the App Store or Google Play?', [
        'Not yet. You can add FlowState to your home screen so it opens like an app.',
      ]],
      ['How do I add FlowState to my home screen?', [
        'On iPhone, open FlowState in Safari, tap Share, then Add to Home Screen. On Android, open it in Chrome, tap the menu, then Add to Home screen or Install app.',
      ]],
      ['Does it work without internet?', [
        'Once you’ve opened FlowState online, it can open again without a connection. If you’re signed in, changes you make offline sync when you’re back online.',
      ]],
    ],
  },
  {
    title: 'Privacy',
    items: [
      ['Who can see my programs?', [
        'Only you. Programs are stored in your account, and each account can read only its own. Guest classes stay in your browser and aren’t sent anywhere.',
      ]],
    ],
  },
];

export function renderFaq(app) {
  document.title = 'FAQ · FlowState';
  app.replaceChildren(h('div', { class: 'faq' },
    h('nav', { class: 'editor-nav' }, h('a', { class: 'back', href: '#/' }, '‹ Programs')),
    h('h1', { class: 'account-title' }, 'FAQ'),
    h('p', { class: 'account-lead' }, 'Answers to common questions about building and running classes with FlowState.'),
    SECTIONS.map((section) => h('section', { class: 'faq-section' },
      h('h2', { class: 'faq-heading' }, section.title),
      section.items.map(([question, answer]) => h('details', { class: 'faq-item' },
        h('summary', { class: 'faq-question' }, question),
        h('div', { class: 'faq-answer' }, answer.map((text) => h('p', {}, text)))))))));
}
