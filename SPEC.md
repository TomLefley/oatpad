# Meeting Notes App — Product Requirements

## Background

This app captures notes taken during a live meeting. The notes are later combined with a meeting transcript by an AI agent to produce an enriched output — such as a summary, action list, interview assessment, or decision record.

The transcript provides a verbatim record of everything said. The notes provide a human interpretive layer: observations, reactions, context, and evolving perceptions that the transcript cannot capture. The value of the notes to the agent depends entirely on the quality of information that can be inferred about *when* each note was written and *what the notetaker meant*.

The notetaker should never have to think about the tool. They just type.

---

## What the Agent Receives

To set context for these requirements, here is an example of what a transcript entry looks like:

```json
{
  "text": "I've been in this role for about four years now, joined straight out of university.",
  "ts": "00:04:41.829",
  "end_ts": "00:04:46.399",
  "display_name": "Participant A"
}
```

Every utterance in the transcript has:
- The exact words spoken
- A precise start and end timestamp (relative to the start of the recording)
- The name of the speaker

The agent will receive the full transcript alongside the notes output. Requirements in this document describe what the notes output must enable the agent to do when combining the two sources.

---

## Requirements

### 1. Capture is free text, always

The notetaker types into a single text area. There are no required fields, dropdowns, tags, or structure. A note can be a fragment, an abbreviation, a half-formed thought, or a full sentence. The app must never block or interrupt capture.

### 2. Every note is timestamped automatically

When the notetaker hits enter (or equivalent), the note is saved with a timestamp. The notetaker does not set this — it is always automatic. This is the wall clock time at the moment of submission.

This timestamp is the primary mechanism by which the agent will locate the relevant transcript segment for each note. Its accuracy directly determines the quality of the final output.

### 3. Edit history is preserved, never overwritten

If the notetaker edits a note after submitting it, the original is preserved. The edit is recorded as a new entry linked to the original.

The agent needs this because a note that changes during the meeting carries information that neither version alone conveys. If a notetaker wrote "seems evasive" at minute 10 and changed it to "actually just uncertain" at minute 25, that revision — and the fact that 15 minutes of conversation elapsed between the two — is meaningful signal.

Each edit must record:
- The new content
- The wall clock timestamp at which the edit was made
- A reference to the note it is revising

### 4. The output links notes to the transcript's recording

The notes output must include a reference to the specific recording it was taken against. This allows the agent to confirm it is combining the correct transcript with the correct notes.

The recording identifier should come from the recording itself, not be manually entered by the notetaker.

### 5. The output preserves the full sequence of events

The notes output is an ordered record of what happened: notes written, edits made, in the sequence they occurred. This ordering must be preserved in the output. The agent uses this sequence to understand how the notetaker's perception evolved across the conversation.

### 6. The output must be machine-readable

The notes output is consumed by an AI agent, not read by a human. It must be structured and unambiguous. Plain prose or unstructured text files are not acceptable outputs.

The format must support:
- Distinguishing original notes from edits
- Linking edits to the notes they revise
- Recording timestamps for every entry

The exact format (JSON, etc.) is an implementation decision, but it must be consistent and parseable without ambiguity.

### 7. Multiple notetakers must remain distinct

If two notetakers independently take notes on the same meeting, their outputs must remain separate — they should not be merged into a single notes file. The agent needs to know which observations came from which person, because two people in the same meeting can have different interpretations, and that disagreement is itself useful information.

The output format must therefore include a notetaker identifier so the agent can distinguish between sources.

---

## What the App Does Not Need to Do

The following are explicitly out of scope. These are processing concerns handled later, not capture concerns:

- Classifying notes by type (observation, action item, etc.)
- Inferring which speaker a note refers to
- Assessing whether a note adds value beyond the transcript
- Summarising or reorganising notes
- Producing the final output artefact

The app's only job is accurate, timestamped, sequenced capture.

---

## Acceptance Criteria

The notes output is fit for purpose if an AI agent, given only the notes output and a matching transcript, can:

1. For any note, identify the transcript segment most likely being referenced — without the notetaker having explicitly linked them.
2. Reconstruct the sequence in which the notetaker's views developed across the conversation.
3. Identify notes that changed, and what portion of the conversation elapsed between the original and the revision.
4. Correctly attribute observations to the right recording session, and — where multiple notetakers exist — to the right person.
