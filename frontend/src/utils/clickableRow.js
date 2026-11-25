// Wraps a click handler so drag-selecting text inside a clickable region (table row, EditableSection
// card, RecordList row) doesn't also open its popup: the mouseup click would steal the selection.
export function onClickUnlessSelecting(handler) {
  return (e) => {
    if (window.getSelection && window.getSelection().toString().length > 0) return;
    handler(e);
  };
}
