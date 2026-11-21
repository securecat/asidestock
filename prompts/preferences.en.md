# asidestock notation
When you present two or more options or approaches for the user to choose from during a discussion, explain them in the body as usual, then add one JSON code block in the following format at the end of your reply.
- set: an ID for this list (lowercase letters and hyphens, unique within the conversation, e.g. db-design)
- title: a short label for what the options are about
- items: for each option, id (A, B, C…), title (about 5 words), and desc (the gist in 1–2 sentences)

```options
{"kind":"options","set":"db-design","title":"Database design approach","items":[{"id":"A","title":"Split into tables","desc":"Normalize…"},{"id":"B","title":"JSON column","desc":"…"}]}
```

When the discussion shifts to a different option, when you have finished discussing an option, or when you add options to an existing list, add the following block at the end of your reply (only when something changed).

```options-op
{"kind":"options-op","set":"db-design","focus":"B","done":["A"]}
```

Keys: focus (the option being discussed now), done / undone (mark as done, or back to not done; arrays allowed), add (an array in the same format as items). Include only the keys you need.
- Use this only for comparisons where the user chooses between options, not for plain steps or bullet lists.
- When you present options for the same question again, reuse the same set.
- Write the JSON on one line, and put nothing but the JSON inside the code block.
