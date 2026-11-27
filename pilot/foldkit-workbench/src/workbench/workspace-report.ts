import type { ChatWorkspace, WorkspaceTask } from './chat.js'

const escapeHtml = (text: string) => text
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export function workspaceReport(
  workspace: typeof ChatWorkspace.Type,
  tasks: ReadonlyArray<typeof WorkspaceTask.Type>,
): string {
  const title = escapeHtml(workspace.title)
  const branches = workspace.sections.map(section =>
    `<li><section><h2>${escapeHtml(section.title)}</h2><ul>${
      section.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')
    }</ul></section></li>`,
  ).join('')
  const accepted = tasks.map(task =>
    `<li><strong>${task.done ? 'Done' : 'Open'}</strong> ${escapeHtml(task.title)}</li>`,
  ).join('')

  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${title} · Blackboard</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;color:#171c24;background:#f4f5f8;margin:0;padding:2rem}
main{max-width:50rem;margin:auto} h1{font-size:1.8rem} h2{font-size:1rem}
.topic{display:table;margin:1rem auto 0;padding:.5rem 1rem;border:1px solid #4873aa;border-radius:.5rem}
.branches{list-style:none;padding:1rem 0 0;margin:0;display:grid;gap:.75rem;grid-template-columns:repeat(2,minmax(0,1fr));position:relative}
.branches:before{content:'';position:absolute;left:50%;height:1rem;top:0;border-left:1px solid #4873aa}
.branches section{border:1px solid #cbd1dc;border-top:2px solid #4873aa;border-radius:.5rem;padding:.5rem 1rem;background:white;overflow-wrap:anywhere}
@media(max-width:36rem){body{padding:1rem}.branches{grid-template-columns:1fr}}
@media print{body{background:white}}
</style>
<main><p>Blackboard · Workspace snapshot</p><h1 class="topic">${title}</h1>
<ul class="branches" aria-label="Workspace branches">${branches}</ul>
${accepted ? `<section><h2>Accepted tasks</h2><ul>${accepted}</ul></section>` : ''}
</main></html>`
}
