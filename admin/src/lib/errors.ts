/** A problem the person can fix; the message is shown to them. */
export class ValidationError extends Error {}

/** Someone else changed the guide while it was being edited. */
export class Conflict extends ValidationError {}

/** An HTTP-level refusal (no access, not found, ...). */
export class HttpError extends Error {
  constructor(public status: number, public title: string, message: string) {
    super(message);
  }
}

export class GitError extends Error {}
