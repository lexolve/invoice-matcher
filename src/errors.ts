export class TokenError {
  readonly _tag = 'TokenError';
  constructor (readonly error: unknown) {} 
}

export class LedgerError {
  readonly _tag = 'LedgerError';
  constructor (readonly error: unknown) {}
}

export class PostingError {
  readonly _tag = 'PostingError';
  constructor (readonly error: unknown) {}
}

export class InvoiceChargebeeError {
  readonly _tag = 'InvoiceChargebeeError';
  constructor (readonly error: unknown) {}
}

export class InvoiceNotFoundError {
  readonly _tag = 'InvoiceNotFoundError';
  constructor (readonly externalRef: string) {}
}