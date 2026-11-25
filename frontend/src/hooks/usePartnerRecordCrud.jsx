import React, { useState } from "react";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";

// Shared add/edit/delete plumbing for the small partner-scoped record lists on Partner Detail,
// each its own resource and endpoint. Owns the create-vs-update state (`editingId` null means
// adding) and the delete confirmation (`deleteCurrent`, offered in the add/edit popup); the caller owns the form fields and payload shaping.
export default function usePartnerRecordCrud({ createFn, updateFn, deleteFn, reload, confirmDialog }) {
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);

  function openAdd(initial) {
    setEditingId(null);
    setForm(initial);
  }

  function openEdit(id, initial) {
    setEditingId(id);
    setForm(initial);
  }

  function close() {
    setForm(null);
    setEditingId(null);
  }

  async function submit(payload) {
    if (editingId) await updateFn(editingId, payload);
    else await createFn(payload);
    await reload();
  }

  // Delete the record the popup is editing, after confirming. Resolves true once it's gone (the popup
  // then closes itself); `describe` gets the form's values for the confirmation title.
  async function deleteCurrent(describe) {
    const confirmed = await confirmDialog({
      title: describe ? describe(form) : "Delete this record?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return false;
    await deleteFn(editingId);
    await reload();
    return true;
  }

  return { form, setForm, editingId, openAdd, openEdit, close, submit, deleteCurrent };
}
