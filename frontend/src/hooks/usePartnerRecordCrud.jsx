import React, { useState } from "react";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";

// Shared add/edit/delete plumbing for the small partner-scoped record lists on Partner Detail,
// each its own resource and endpoint. Owns the create-vs-update state (`editingId` null means
// adding) and the delete confirmation; the caller owns the form fields and payload shaping.
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

  async function handleDelete(item, describe) {
    const confirmed = await confirmDialog({
      title: describe ? describe(item) : "Delete this record?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deleteFn(item.id);
    await reload();
  }

  return { form, setForm, editingId, openAdd, openEdit, close, submit, handleDelete };
}
