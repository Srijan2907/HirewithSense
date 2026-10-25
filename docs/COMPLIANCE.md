# Compliance and candidate rights

Automated tools in hiring are regulated in a growing number of places: New York City's Local Law 144,
the EU AI Act (employment is a high-risk use), Illinois' Artificial Intelligence Video Interview
Act, Colorado's AI statute, and the GDPR's restrictions on solely automated decisions. The product
is built so that an employer can meet those obligations with the features below. This page is a
description of what the software does, not legal advice; your own counsel decides what your
deployment needs.

## Notice and consent

Before an interview can start, the candidate sees the AI-disclosure notice and must accept it. The
notice explains that an automated system asks the questions, how the interview is evaluated, that
interface events are recorded, that a person makes the decision, and how to request an alternative
process or accommodation. It is versioned (`AI_DISCLOSURE_VERSION` in `packages/shared`); the
consent record stores the version, a hash of the exact text, the timestamp, the IP address and the
user agent. If the text changes after a candidate loaded it, the API rejects the stale consent and
the candidate reviews the new text.

The accommodation request typed at that step is stored with the consent and shown to recruiters on
the interview's Consent tab.

## Human decisions

The report ends in a recommendation, never a decision. Candidates are not rejected, advanced or
ranked out by the software. A recruiter records one of `advance`, `hold`, `reject` or `hire` with a
written reason, and the system marks decisions that contradict a definite recommendation so they
can be reviewed. The candidate-facing pages state that no decision is automatic.

## What is evaluated

Only the content of answers and code. Names, emails, phone numbers and links are redacted before
text reaches a scoring prompt; education institutions are blanked in the resume context; voice is
transcribed to text so delivery is never assessed; and every scoring prompt instructs the model not
to infer or consider protected characteristics. Integrity telemetry (focus loss, paste events,
full-screen exits) is disclosed to the candidate, shown to recruiters in its own panel with a note
that it is informational, and excluded from all scoring.

## Audit trail

Every consent, interview start, submission, report view, detail view, decision, invitation, role
change and configuration edit writes to the audit log with the actor, target, IP and timestamp.
Organization admins can read it in the Consent & audit tab of an interview and through
`GET /api/v1/admin/audit`.

## Bias auditing

Rankings for a job can be exported as CSV with per-competency scores, coverage, recommendation and
decision for every finished interview. Combined with self-reported demographic data collected
through your own process, this is the input an independent auditor needs for the selection-rate and
impact-ratio analysis Local Law 144 requires. Each job has a `biasAuditUrl` field for the public
summary of the latest audit.

## Retention and deletion

- Each organization sets a retention period (default 365 days). A nightly job removes the content
  of interviews older than that: turns, transcript, submissions, telemetry and the report body.
  The interview row itself remains as an anonymised record of the fact that an interview happened.
- A candidate can delete their account from the profile page. The API deletes resume files, all
  interview content for that candidate, and replaces identifying fields on the user record with
  placeholders. Sessions are revoked immediately.
- Resume files for deleted users that were missed (for example because storage was unavailable at
  the time) are cleaned up by the nightly job.

## Data access and explanation

Everything the system holds about an interview is visible to the employer on the interview detail
page, including which provider and model produced the report and how much evidence it saw. That
page, plus the audit log, is what you would use to answer a candidate's request for a copy of their
data or an explanation of how the report was produced. A per-candidate export endpoint is a natural
next step if your jurisdiction requires self-service access.

## What the software does not do

It does not record video or audio; it does not run face or voice analysis; it does not collect
demographic data; and it does not take any action on a candidate's application by itself. If you
add integrations that do any of these, revisit the disclosure text and your own obligations.
