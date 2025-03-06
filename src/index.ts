import axios from "axios";
import { Effect, pipe, Schedule } from "effect"
import { addDays, format } from "date-fns";
import { TokenError, InvoiceChargebeeError, LedgerError, PostingError } from "./errors";
import { getInvoice, recordInvoicePayment } from "./chargebee";
import { Invoice } from "chargebee-typescript/lib/resources";
import { Request, Response } from "@google-cloud/functions-framework";

const config = {
  consumerToken: process.env.CONSUMER_TOKEN,
  employeeToken: process.env.EMPLOYEE_TOKEN,
  appname: process.env.APPNAME,
  chargebeeApiKey: process.env.CHARGEBEE_API_KEY
}

const baseUrl = 'https://tripletex.no/v2';

interface Ledger {
  from: number;
  count: number;
  versionDigest: string;
  values: LedgerAccount[];
}

interface LedgerAccount {
  postings: Posting[];
}

interface Posting {
  id: number;
  url: string;
  date: string;
  description: string;
  type: 
    | 'INCOMING_PAYMENT'
    | 'INCOMING_PAYMENT_OPPOSITE'
    | 'INCOMING_INVOICE_CUSTOMER_POSTING' 
    | 'INVOICE_EXPENSE'
    | 'OUTGOING_INVOICE_CUSTOMER_POSTING'
    | 'WAGE';
  // External reference for identifying payment basis of the posting,
  // e.g., KID, customer identification or credit note number.
  externalRef: string;
  matched: boolean;
  postingRuleId: string;
  amount: number;
  amountCurrency: number;
  amountGross: number;
  amountGrossCurrency: number;
}

const shouldPostingBeReconciled= (posting: Posting): boolean =>
  posting.type === 'INCOMING_PAYMENT' &&
  posting.externalRef?.length > 0 &&
  Math.abs(posting.amount) > 0;

type DateFormat = `${string}-${string}-${string}`

const getDateFromToday = (daysDiff: number): Effect.Effect<DateFormat, never> => 
  Effect.succeed(
    format(addDays(new Date, daysDiff), 
      'yyyy-MM-dd'
    ) as DateFormat
  )

const createSessionToken = (expirationDate: DateFormat): Effect.Effect<string, TokenError> => 
  Effect.tryPromise({
    try: async () => {
      const { consumerToken, employeeToken } = config;
      const response = await axios.put(`${baseUrl}/token/session/create`, null, {
        params: {
          consumerToken,
          employeeToken,
          expirationDate
        }
      });
      return response.data.value.token;
    },
    catch: (error) => new TokenError(error)
  })


/**
 * @param dateFrom Format is yyyy-MM-dd (from and incl.).
 * @param dateTo Format is yyyy-MM-dd (to and excl.).
 * @returns Ledger for the given period.  
 */
const fetchLedger = (dateFrom: DateFormat, dateTo: DateFormat, sessionToken: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await axios.get(`${baseUrl}/ledger`, {
        headers: {
          ...createAuthHeader(sessionToken)
        },
        params: {
          dateFrom,
          dateTo
        }
      });
      return response.data;
    },
    catch: (error) => new LedgerError(error)
  })
 
const fetchPosting = (id: number, sessionToken: string) => 
  pipe(
    Effect.tryPromise({
      try: async () => {
        const response = await axios.get(`${baseUrl}/ledger/posting/${id}`, {
          headers: {
            ...createAuthHeader(sessionToken)
          }
        });
        return response.data.value as Posting;
      },
      catch: (error) => new PostingError(error)
    }),
    Effect.retry(Schedule.exponential('250 millis').pipe(Schedule.intersect(Schedule.recurs(3))))
  )

const createAuthHeader = (sessionToken: string): { Authorization: string } => {
  return {
    'Authorization': `Basic ${btoa(`0:${sessionToken}`)}`  // Using 0 as the companyId
  }
}

const fetchPostings = (sessionToken: string): Effect.Effect<Posting[], PostingError | LedgerError> =>
  pipe(
    Effect.all([getDateFromToday(-1), getDateFromToday(1)]),
    Effect.flatMap(([dateFrom, dateTo]) => fetchLedger(dateFrom, dateTo, sessionToken)),
    Effect.tap((ledger: Ledger) => 
      console.log(`Fetched ledger successfully with ${ledger.values.flatMap((a) => a.postings).length} postings`)),
    Effect.map((ledger: Ledger) => 
      ledger.values.flatMap((a) => a.postings)),
    Effect.flatMap((postings: Posting[]) => 
      Effect.all(postings.map((posting) => fetchPosting(posting.id, sessionToken)))
    )
  );


 const reconcileUnmatchedPostings = (postings: Posting[]): Effect.Effect<Invoice[], InvoiceChargebeeError> => {
  const postingsToReconcile = postings.filter(shouldPostingBeReconciled);
  const reconcilePosting = (posting: Posting): Effect.Effect<Invoice, InvoiceChargebeeError> =>
    pipe(
      getInvoice(posting.externalRef),
      Effect.flatMap((invoiceId) => 
        recordInvoicePayment(
          invoiceId,
          // Convert amount to cents for Chargebee.
          // Note: Math.abs() is used to ensure that the amount is positive
          // as INCOMING_PAYMENT postings are negative.
          Math.round(Math.abs(posting.amount) * 100)
        )
      ),
    );
  return pipe(
    Effect.all(postingsToReconcile.map(reconcilePosting), { concurrency: 2, mode: 'either' }),
    Effect.map((invoices) => invoices.filter((invoice) => invoice._tag === 'Right').map((invoice) => invoice.right))
  )

};

const program = () => pipe(
  getDateFromToday(1),
  Effect.flatMap(createSessionToken),
  Effect.flatMap(fetchPostings),
  Effect.flatMap(reconcileUnmatchedPostings),
  Effect.flatMap((invoices) =>
    Effect.all(invoices.map((invoice) =>
      Effect.sync(() =>
        console.log(`Successfully reconciled invoice ${invoice.id} ${invoice.customer_id}`
        ))
    ))
  )
)



export const main = async (req: Request, res: Response) => {
  try {
    await Effect.runPromise(program());
    res.status(200).send()
  } catch (error) {
    console.error('Cloud Function Error:', error);
    res.status(500).send('Internal Server Error');
  }
};