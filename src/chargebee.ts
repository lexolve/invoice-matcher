import { ChargeBee } from 'chargebee-typescript';
import { Customer, Invoice, PaymentReferenceNumber } from 'chargebee-typescript/lib/resources';
import { Effect } from 'effect';
import { Brand } from "effect"
import { InvoiceChargebeeError } from './errors';
import { sendFormattedSlackNotification } from './slack';

const chargebee = new ChargeBee();
chargebee.configure({
  site: 'lexolve',
  api_key: process.env.CHARGEBEE_API_KEY
})

export type InvoiceId = string & Brand.Brand<"InvoiceId">
const InvoiceId = Brand.nominal<InvoiceId>()

/** 
 * @param externalRef External reference number, aka as KID in Norway 
 */
export const getInvoice = (externalRef: string): Effect.Effect<InvoiceId, InvoiceChargebeeError>=>
  Effect.tryPromise({
    try: async () => {
      const response = await chargebee.invoice.list_payment_reference_numbers({
        payment_reference_number: { number: { is: externalRef } }
      }).request()

      if (response.list.length === 0) {
        throw new Error(`No invoice found for external reference ${externalRef}`)
      }
      const prn: PaymentReferenceNumber = response.list[0].payment_reference_number;
      if (!prn.invoice_id) {
        throw new Error(`No invoice ID associated with external reference ${externalRef}`)
      }
      return InvoiceId(prn.invoice_id);
    },
    catch: (error) => new InvoiceChargebeeError(error)
  })

/**
 * @param invoiceId ID of the invoice to record payment for
 * @param amount Payment transaction amount in *cents* (e.g., 1000 for 10.00)
 */
export const recordInvoicePayment = (invoiceId: string, amount: number): Effect.Effect<Invoice, InvoiceChargebeeError> =>
  Effect.tryPromise({
    try: async () => {
      let updateSlack = true;
      const response = await chargebee.invoice.record_payment(invoiceId, {
        transaction: {
          amount,
          payment_method: 'bank_transfer',
          date: Math.floor(Date.now() / 1000) // Chargebeee expects Unix timestamp in seconds
        } 
      })
      .setIdempotencyKey(`${invoiceId}-${amount}`)
      .request()
      .catch((error: { http_status_code?: number }) => {
        // If the invoice is already paid, retrieve the invoice and return it
        // This typically happens when the payment has not been recorded as "matched" in the ledger
        if (error.hasOwnProperty('http_status_code') && error['http_status_code'] === 422) {
          updateSlack = false;
          return chargebee.invoice.retrieve(invoiceId).request();
        }
      }) 

      const customerResponse = await chargebee.customer.retrieve(response.invoice.customer_id)
        .request();

      const customer = customerResponse.customer as Customer
      const invoice = response.invoice as Invoice;
      if (updateSlack) {
        await sendFormattedSlackNotification('Invoice payment recorded (bank transfer)', {
          'Invoice ID': invoice.id,
          'Company': `${customer.company}`,
          'User': `${customer.email} ${customer.phone ? `(${customer.phone})` : ''}`,
          'Amount Paid': `${invoice.currency_code} ${Math.floor((invoice.amount_paid ?? 0)/100)}`,
          'Amount Due': `${invoice.currency_code} ${Math.floor((invoice.amount_due ?? 0)/100)}`
        })
      }
      return invoice;
    },
    catch: (error) => new InvoiceChargebeeError(error)
    
  })

