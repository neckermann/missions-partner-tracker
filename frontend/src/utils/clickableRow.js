// Wraps a click handler so a drag-select of text inside the clickable
// region (a table row, a whole-card EditableSection, a RecordList row)
// doesn't also open that row/card's popup -- without this, finishing a
// text selection (e.g. to copy an email address out of a read-only field)
// fires a click on mouseup and steals the selection by popping a modal
// open instead. One implementation, reused everywhere something is both
// "a block of readable text" and "a click target."
export function onClickUnlessSelecting(handler) {
  return (e) => {
    if (window.getSelection && window.getSelection().toString().length > 0) return;
    handler(e);
  };
}
