# Keyboard scope

By default the keys listen on the whole page, which suits a full-window viewer. A viewer embedded
in a page with text around it should pass `keys: 'focus'`: the keys then act only while the
viewer's element has focus, so the arrow keys and Space still scroll the page otherwise. The
element gets `tabindex="0"` (unless it has one) and takes focus on a click or tap, without
matching `:focus-visible`, so a keyboard focus ring styled by the page shows only when Tab
reaches it. Held keys are released when focus leaves. `keys: false` turns the keyboard off.
