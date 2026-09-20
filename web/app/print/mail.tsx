'use client';
/* oxlint-disable next/no-html-link-for-pages -- static pages */
import { Printer } from 'lucide-react';
import './print.css';

// The two pieces of mail used in the demo. Their text matches
// server/rewind/scans.py DEMO_DOCUMENTS so the dashboard files exactly what
// is on the paper. Print at 100% on US Letter.

export const POSTCARD = {
  date: 'September 14, 2026',
  message: [
    'Hi Mom!',
    'Sunny here in Portland. The kids picked apples all weekend and Lily drew you a picture (it\u2019s in the mail).',
    'Counting the days until Thanksgiving. Save me a slice of your pie!',
  ],
  sign: 'Love, Emma',
  to: ['Rose Whitaker', '14 Orchard Lane', 'Boston, MA 02116'],
};

export const BILL = {
  practice: 'Maple Grove Family Medicine',
  tagline: 'Primary care for every generation',
  doctor: 'Anita Shah, MD',
  address: '220 Maple Grove Road, Suite 4',
  city: 'Boston, MA 02116',
  phone: '(617) 555-0142',
  hours: 'Monday to Friday, 8:00 am to 5:00 pm',
  web: 'pay.maplegrovefm.example',
  taxId: '04-2271130',
  npi: '1093817264',
  statementDate: 'September 12, 2026',
  statementId: 'ST-2026-091204',
  account: 'MG-20461',
  patient: 'Rose Whitaker',
  guarantor: 'Rose Whitaker',
  dob: '03/22/1951',
  street: '14 Orchard Lane',
  cityLine: 'Boston, MA 02116',
  insurer: 'Blue Harbor Health PPO',
  memberId: 'BHH 4471 0239 01',
  groupId: 'MGFM-220',
  claim: 'CLM-88213047',
  claimProcessed: 'September 11, 2026',
  serviceDate: 'Sep 8, 2026',
  dueDate: 'September 30, 2026',
  due: '$45.00',
  lines: [
    {
      cpt: '99397',
      description: 'Preventive visit, established patient, 65+',
      charge: '$185.00',
      insurance: '$155.00',
      adjustment: '$0.00',
      patient: '$30.00',
    },
    {
      cpt: '36415',
      description: 'Venipuncture (blood draw)',
      charge: '$30.00',
      insurance: '$15.00',
      adjustment: '$0.00',
      patient: '$15.00',
    },
  ],
  totals: {
    charge: '$215.00',
    insurance: '$170.00',
    adjustment: '$0.00',
    patient: '$45.00',
  },
};

export function PrintBar({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <header className="print-bar">
      <div>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      <span>
        <button
          type="button"
          className="print-btn"
          onClick={() => window.print()}
        >
          <Printer /> Print
        </button>
        <a href="/print">All demo mail</a>
        <a href="/">Back to Rewind</a>
      </span>
    </header>
  );
}

export function PostcardMessageSide() {
  return (
    <section className="cut postcard-sheet" aria-label="Postcard, message side">
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
  );
}

export function PostcardPictureSide() {
  return (
    <section className="cut postcard-sheet" aria-label="Postcard, picture side">
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
  );
}

// A full-page patient statement, the kind a practice mails after insurance
// has paid its share.
export function MedicalStatement() {
  const b = BILL;
  return (
    <article className="stmt" aria-label="Patient statement">
      <header className="stmt-head">
        <div className="stmt-brand">
          <span className="stmt-logo" aria-hidden="true">
            <i />
          </span>
          <div>
            <b>{b.practice}</b>
            <span>{b.tagline}</span>
            <span>
              {b.address} · {b.city}
            </span>
            <span>
              {b.phone} · {b.web}
            </span>
          </div>
        </div>
        <div className="stmt-title">
          <b>Patient Statement</b>
          <table>
            <tbody>
              <tr>
                <td>Statement date</td>
                <td>{b.statementDate}</td>
              </tr>
              <tr>
                <td>Account number</td>
                <td>{b.account}</td>
              </tr>
              <tr>
                <td>Statement ID</td>
                <td>{b.statementId}</td>
              </tr>
              <tr className="stmt-title-due">
                <td>Payment due</td>
                <td>{b.dueDate}</td>
              </tr>
              <tr className="stmt-title-amount">
                <td>Amount due</td>
                <td>{b.due}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </header>

      <div className="stmt-address-row">
        <div className="stmt-addressee">
          <small>Patient / Guarantor</small>
          <b>{b.guarantor}</b>
          <span>{b.street}</span>
          <span>{b.cityLine}</span>
        </div>
        <div className="stmt-contact">
          <small>Questions about this statement?</small>
          <span>
            Call <b>{b.phone}</b>, {b.hours}
          </span>
          <span>
            Pay online at <b>{b.web}</b> with account <b>{b.account}</b>
          </span>
          <span>
            Provider: {b.doctor} · NPI {b.npi} · Tax ID {b.taxId}
          </span>
        </div>
      </div>

      <section className="stmt-summary">
        <h2>Account summary</h2>
        <table>
          <tbody>
            <tr>
              <td>Previous balance</td>
              <td>$0.00</td>
            </tr>
            <tr>
              <td>New charges</td>
              <td>{b.totals.charge}</td>
            </tr>
            <tr>
              <td>Insurance payments and adjustments</td>
              <td>-{b.totals.insurance}</td>
            </tr>
            <tr>
              <td>Patient payments received</td>
              <td>$0.00</td>
            </tr>
            <tr className="stmt-balance">
              <td>Balance due by {b.dueDate}</td>
              <td>{b.due}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="stmt-detail">
        <h2>Visit detail</h2>
        <p className="stmt-visit">
          <b>{b.serviceDate}</b> · Office visit with {b.doctor} · Patient{' '}
          {b.patient} (DOB {b.dob})
        </p>
        <table className="stmt-lines">
          <thead>
            <tr>
              <th>Date</th>
              <th>Code</th>
              <th>Description</th>
              <th>Charges</th>
              <th>Insurance paid</th>
              <th>Adjustments</th>
              <th>You owe</th>
            </tr>
          </thead>
          <tbody>
            {b.lines.map((line) => (
              <tr key={line.cpt}>
                <td>{b.serviceDate}</td>
                <td>{line.cpt}</td>
                <td>{line.description}</td>
                <td>{line.charge}</td>
                <td>{line.insurance}</td>
                <td>{line.adjustment}</td>
                <td>{line.patient}</td>
              </tr>
            ))}
            <tr className="stmt-total">
              <td colSpan={3}>Totals for this visit</td>
              <td>{b.totals.charge}</td>
              <td>{b.totals.insurance}</td>
              <td>{b.totals.adjustment}</td>
              <td>{b.totals.patient}</td>
            </tr>
          </tbody>
        </table>
        <div className="stmt-insurance">
          <div>
            <small>Insurance on file</small>
            <span>
              {b.insurer} · Member {b.memberId} · Group {b.groupId}
            </span>
          </div>
          <div>
            <small>Claim</small>
            <span>
              {b.claim} · processed {b.claimProcessed}
            </span>
          </div>
          <div>
            <small>Your share</small>
            <span>Copay {b.due} · Deductible $0.00 · Coinsurance $0.00</span>
          </div>
        </div>
      </section>

      <section className="stmt-message">
        <p>
          Thank you for choosing {b.practice}. Your insurance has processed the
          claim for your visit on {b.serviceDate}; the balance shown is your
          copay. Please pay <b>{b.due}</b> by <b>{b.dueDate}</b>. Balances
          unpaid after 60 days may be referred to a billing partner.
        </p>
        <div className="stmt-pay">
          <div>
            <b>Online</b>
            <span>
              {b.web}
              <br />
              Account {b.account}
            </span>
          </div>
          <div>
            <b>Phone</b>
            <span>
              {b.phone}
              <br />
              {b.hours}
            </span>
          </div>
          <div>
            <b>Mail</b>
            <span>
              Return the slip below with a check payable to {b.practice}.
            </span>
          </div>
          <div>
            <b>In person</b>
            <span>
              At the front desk, {b.address}, {b.city}.
            </span>
          </div>
        </div>
        <p className="stmt-fine">
          If paying this balance is difficult, please call us: payment plans
          and financial assistance are available. This statement reflects
          activity through {b.statementDate}. Payments received after that date
          will appear on your next statement.
        </p>
      </section>

      <div className="stmt-tear" aria-hidden="true">
        <span>Please detach and return this portion with your payment</span>
      </div>

      <section className="stmt-coupon" aria-label="Remittance slip">
        <div className="stmt-coupon-left">
          <div className="stmt-coupon-brand">
            <b>{b.practice}</b>
            <span>PO Box 2210 · Boston, MA 02205-2210</span>
          </div>
          <div className="stmt-coupon-to">
            <small>Statement for</small>
            <b>{b.guarantor}</b>
            <span>{b.street}</span>
            <span>{b.cityLine}</span>
          </div>
          <div className="stmt-card">
            <small>Paying by card</small>
            <div className="stmt-card-row">
              <span className="stmt-box wide">Card number</span>
              <span className="stmt-box">Exp.</span>
              <span className="stmt-box">CVV</span>
            </div>
          </div>
        </div>
        <div className="stmt-coupon-right">
          <table>
            <tbody>
              <tr>
                <td>Account number</td>
                <td>{b.account}</td>
              </tr>
              <tr>
                <td>Statement date</td>
                <td>{b.statementDate}</td>
              </tr>
              <tr>
                <td>Payment due date</td>
                <td>{b.dueDate}</td>
              </tr>
              <tr className="stmt-coupon-amount">
                <td>Amount due</td>
                <td>{b.due}</td>
              </tr>
              <tr className="stmt-coupon-enclosed">
                <td>Amount enclosed</td>
                <td>
                  <span className="stmt-box amount">$</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="stmt-coupon-fine">
            Make checks payable to {b.practice}. Write account {b.account} on
            your check. Do not send cash.
          </p>
        </div>
      </section>

      <footer className="stmt-foot">
        <span>
          {b.practice} · {b.address}, {b.city} · {b.phone}
        </span>
        <span>
          Statement {b.statementId} · Page 1 of 1
        </span>
      </footer>
    </article>
  );
}
