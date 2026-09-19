---
"@jmfederico/pi-web": patch
---

Remove the retired research-record automation extension, its mandatory agent instructions, state parser and obsolete documentation. Keep the independent, manually updated experiment link table under the `experiment-visualization` plugin id. Existing sessions need `/reload` to unload the extension; browser panels need a page reload. Training, downstream evaluation and experiment monitoring are unchanged.
