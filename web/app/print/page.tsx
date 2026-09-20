'use client';
/* oxlint-disable next/no-html-link-for-pages -- static page */
import { Printer } from 'lucide-react';
import './print.css';

// The two pieces of mail used in the demo. Their text matches
// server/rewind/scans.py DEMO_DOCUMENTS so the dashboard files exactly what
// is on the paper. Print at 100%, cut along the dotted lines.

const POSTCARD = {
  date: 'September 14, 2026',
  message: [
    'Hi Mom!',
    'Sunny here in Portland. The kids picked apples all weekend and Lily drew you a picture (it\u2019s in the mail).',
    'Counting the days until Thanksgiving. Save me a slice of your pie!',
  ],
  sign: 'Love, Emma',
  to: ['Rose Whitaker', '14 Orchard Lane', 'Boston, MA 02116'],
};

const BILL = {
  practice: 'Maple Grove Family Medicine',
  doctor: 'Anita Shah, MD',
  address: '220 Maple Grove Road, Suite 4 \u00b7 Boston, MA 02116',
  phone: '(617) 555-0142',
  statementDate: 'September 12, 2026',
  account: 'MG-20461',
  patient: 'Rose Whitaker',
  dob: '03/22/1951',
  serviceDate: 'Sep 8, 2026',
  service: 'Annual wellness visit (99397)',
  charge: '$215.00',
  insurance: '$170.00',
  due: '$45.00',
  dueDate: 'September 30, 2026',
};

export default function PrintMail() {
  return (
    <div className="print">
      <header className="print-bar">
        <div>
          <h1>Demo mail for Rewind</h1>
          <p>
            Print at 100% on letter paper, cut along the dotted lines, and hold
            both pieces in view when you tap <b>Scan mail</b> on the phone. The
            postcard lands in Letters; the bill lands on the calendar.
          </p>
        </div>
        <span>
          <button
            type="button"
            className="print-btn"
            onClick={() => window.print()}
          >
            <Printer /> Print
          </button>
          <a href="/">Back to Rewind</a>
        </span>
      </header>

      <main className="sheet">
        <section
          className="cut postcard-sheet"
          aria-label="Postcard, message side"
        >
          <div className="pcp">
            <div className="pcp-left">
              <p className="pcp-date">{POSTCARD.date}</p>
              {POSTCARD.message.map((line) => (
                <p key={line} className="pcp-line">
                  {line}
                </p>
              ))}
              <p className="pcp-sign">{POSTCARD.sign}</p>
              <span className="pcp-heart" aria-hidden="true">
                ♡
              </span>
            </div>
            <div className="pcp-divider" />
            <div className="pcp-right">
              <div className="pcp-stamp" aria-hidden="true">
                <span>
                  <i className="sun" />
                  <i className="hill" />
                  <small>USA · FOREVER</small>
                </span>
              </div>
              <div className="pcp-postmark" aria-hidden="true">
                <span>Portland OR</span>
                <small>Sep 14 2026</small>
                <em>· · · ·</em>
              </div>
              <div className="pcp-address">
                {POSTCARD.to.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
              <p className="pcp-fine">POST CARD · Made in Oregon</p>
            </div>
          </div>
        </section>

        <section className="cut bill-sheet" aria-label="Medical bill">
          <div className="bill">
            <div className="bill-top">
              <div className="bill-logo" aria-hidden="true">
                <i />
              </div>
              <div className="bill-practice">
                <b>{BILL.practice}</b>
                <span>{BILL.doctor} · Family Medicine</span>
                <span>{BILL.address}</span>
                <span>{BILL.phone}</span>
              </div>
              <div className="bill-statement">
                <b>STATEMENT</b>
                <span>
                  Statement date <strong>{BILL.statementDate}</strong>
                </span>
                <span>
                  Account # <strong>{BILL.account}</strong>
                </span>
              </div>
            </div>

            <div className="bill-who">
              <div>
                <small>Patient</small>
                <b>{BILL.patient}</b>
                <span>14 Orchard Lane, Boston, MA 02116</span>
                <span>DOB {BILL.dob}</span>
              </div>
              <div className="bill-amount">
                <small>Amount due</small>
                <b>{BILL.due}</b>
                <span className="bill-duedate">
                  Due by <strong>{BILL.dueDate}</strong>
                </span>
              </div>
            </div>

            <table className="bill-table">
              <thead>
                <tr>
                  <th>Date of service</th>
                  <th>Description</th>
                  <th>Charge</th>
                  <th>Insurance paid</th>
                  <th>You owe</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{BILL.serviceDate}</td>
                  <td>{BILL.service}</td>
                  <td>{BILL.charge}</td>
                  <td>{BILL.insurance}</td>
                  <td>{BILL.due}</td>
                </tr>
                <tr className="total">
                  <td colSpan={4}>Total patient responsibility</td>
                  <td>{BILL.due}</td>
                </tr>
              </tbody>
            </table>

            <p className="bill-msg">
              Thank you for visiting Dr. Shah. Your insurance has been billed;
              the balance above is your copay. Please pay by{' '}
              <b>{BILL.dueDate}</b> online, by mail with the slip below, or by
              calling {BILL.phone}. Questions about your statement? We are happy
              to help, Monday to Friday, 8 am to 5 pm.
            </p>

            <div className="bill-detach">
              <span>detach and return with payment</span>
            </div>
            <div className="bill-slip">
              <div>
                <small>Account</small>
                <b>{BILL.account}</b>
              </div>
              <div>
                <small>Patient</small>
                <b>{BILL.patient}</b>
              </div>
              <div>
                <small>Due date</small>
                <b>{BILL.dueDate}</b>
              </div>
              <div>
                <small>Amount due</small>
                <b>{BILL.due}</b>
              </div>
              <div className="bill-box">
                <small>Amount enclosed</small>
                <b>$</b>
              </div>
            </div>
          </div>
        </section>
      </main>

      <main className="sheet page-two">
        <section
          className="cut postcard-sheet"
          aria-label="Postcard, picture side"
        >
          <div className="pcf">
            <i className="sun" />
            <i className="mtn a" />
            <i className="mtn b" />
            <i className="trees" />
            <i className="river" />
            <span className="pcf-title">
              <small>greetings from</small>
              Portland
              <em>Oregon</em>
            </span>
          </div>
          <p className="sheet-note">
            Optional picture side. Glue it to the back of the message side, or
            leave it out; the scan only needs the message side.
          </p>
        </section>
      </main>
    </div>
  );
}
