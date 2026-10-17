/* This conversation, condensed, plus the controller's rules. Data only. */
(function (root) {
  const MESSAGES = [
    { r: 'you', t: "Research OpenAI's new generative UI in ChatGPT. What did they actually build?", title: 'What did OpenAI build?', task: ['discovery', 'doing'] },
    { r: 'claude', t: "It's called Intelligent UI and shipped with GPT-6 on October 7, 2026: a library of native components plus a compiler that renders while the model writes.", title: 'Intelligent UI, GPT-6', src: ['OpenAI announcement', 'https://openai.com/index/gpt-6-for-everyone/'] },
    { r: 'claude', t: 'Thesys took it apart: the model writes DIL, the server compiles it, a sandbox runs it. A button can only send a new message.', title: 'Reverse-engineered', src: ['Thesys analysis', 'https://www.openui.com/blog/how-chatgpt-intelligent-ui-works'], task: ['discovery', 'done'] },
    { r: 'you', t: 'Look at my repo Observstory. How does its UI change as the project moves through phases?', title: 'Observstory', src: ['Observstory', 'https://github.com/blackmath88/observstory'], task: ['observstory', 'doing'] },
    { r: 'claude', t: 'State belongs to the project, form to the projection. A deterministic compiler turns typed state into a scene, and the scene into a map.', title: 'State vs projection', dec: 'Compile, don\'t generate', task: ['observstory', 'done'] },
    { r: 'you', t: 'Honestly, Intelligent UI feels like nicer diagrams. Content from the LLM, yes. But compile it to a UI library.', title: 'Content LLM, form compiled' },
    { r: 'claude', t: 'The real difference: a deterministic compiler needs the shapes up front. Generative UI guesses the shape per question.', title: 'Known vs guessed shapes' },
    { r: 'you', t: 'It gets interesting when the UI becomes working state the model can see.', title: 'UI as working state', dec: 'UI as shared state' },
    { r: 'claude', t: 'Then the truth must live outside the HTML, as data: files, a schema, a change signal, a revision.', title: 'State outside the HTML' },
    { r: 'you', t: 'Think VS Code. Files are the state; editor, preview and chat are modules. The LLM is one module, not the owner.', title: 'The VS Code picture', dec: 'LLM is a module' },
    { r: 'claude', t: "That's the blackboard architecture: Hearsay-II, Carnegie Mellon, the 1970s. Knowledge sources write to a shared board.", title: 'Blackboard', dec: 'Blackboard architecture' },
    { r: 'you', t: 'Make me a summary JSON.', title: 'Summary 1', task: ['summary1', 'done'] },
    { r: 'you', t: 'How does an LLM listen?', title: 'How does an LLM listen?' },
    { r: 'claude', t: "It doesn't. Interrupts, Kubernetes reconcile loops, the blackboard agenda: a cheap watcher decides when to wake it.", title: 'Listening = trigger policy', dec: 'Listening is a trigger policy' },
    { r: 'you', t: 'Make the agenda a small local model. And chat has the Enter key; AI UI has no moment where entry is done.', title: 'Small agenda, Enter key', dec: 'Small model as agenda' },
    { r: 'you', t: 'Build the Hearsay-II explainer and leave Enter as the open problem. My repo br-ai-nstorm tries the same thing.', title: 'Blackboard explainer', src: ['br-ai-nstorm', 'https://github.com/blackmath88/br-ai-nstorm'], task: ['blackboard', 'done'] },
    { r: 'claude', t: 'Enter bundles four functions: boundary, authority, trigger, addressee. Diffused, it becomes an override instead of a gate.', title: 'Enter, diffused', dec: 'Diffuse the Enter key' },
    { r: 'you', t: 'Signal in the UI, and the model decides what the UI becomes. Semantic hyperlinks that morph in real time.', title: 'Semantic morphing', dec: 'Semantic morphing' },
    { r: 'claude', t: 'NLS, adaptive hypermedia, Morphic, and now View Transitions. Morphing needs stable identity, which a compiler gives you.', title: 'Roots of morphing', src: ['View Transitions', 'https://view-transitions.chrome.dev/'] },
    { r: 'you', t: 'Build it. Simulation or bring your own API.', title: 'Morph explainer', task: ['morph', 'done'] },
    { r: 'claude', t: 'The open question: a view changes no state, but it decides what you see. Where does view end and authority begin?', title: 'Authority?', dec: 'Authority of the frame' },
    { r: 'you', t: 'Make the second summary.', title: 'Summary 2', task: ['summary2', 'done'] },
    { r: 'claude', t: 'Answer-shaped UI wins for curiosity. Workspace-shaped UI wins for ongoing work.', title: 'Answer vs workspace', dec: 'Answer vs workspace' },
    { r: 'you', t: 'My repo paratext tells this story. Funny that we came back to chat: it is the scroll again.', title: 'Paratext', src: ['paratext-demo', 'https://github.com/blackmath88/paratext-demo'] },
    { r: 'you', t: 'Build Rolle und Kodex, with a north star.', title: 'Rolle und Kodex', task: ['kodex', 'done'] },
    { r: 'you', t: 'Start as a chat and let panels grow as the project grows. CLI look, pixel graphics.', title: 'Grow diachronically', dec: 'Grow diachronically', task: ['growing', 'doing'], task2: ['pilot', 'todo'] }
  ];
  const TASKS = {
    discovery: 'Discovery: Intelligent UI', observstory: 'Read Observstory', summary1: 'Summary JSON 1', blackboard: 'Blackboard explainer',
    morph: 'Morph explainer', summary2: 'Summary JSON 2', kodex: 'Rolle und Kodex', growing: 'Growing workbench', pilot: 'CLI pilot v1'
  };
  // Visible, deterministic growth rules. The controller proposes; you decide.
  const RULES = [
    { mod: 'index',   name: 'Index',         count: s => s.messages, at: 10, ask: n => `${n} messages. Scrolling back gets slow. Add an index pane?` },
    { mod: 'map',     name: 'Reasoning map', count: s => s.decisions, at: 4, ask: n => `${n} decisions so far, and they build on each other. Add a reasoning map?` },
    { mod: 'kanban',  name: 'Kanban',        count: s => s.tasks, at: 4, ask: n => `${n} tasks have come up. Track them on a board?` },
    { mod: 'sources', name: 'Sources',       count: s => s.sources, at: 5, ask: n => `${n} sources mentioned. Keep them on a shelf?` }
  ];
  root.REPLAY = { MESSAGES, TASKS, RULES };
})(window);
