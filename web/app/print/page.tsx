'use client';
import {
  MedicalStatement,
  PostcardMessageSide,
  PostcardPictureSide,
  PrintBar,
} from './mail';

// All the demo mail on one page. /print/postcard and /print/bill print one
// piece each.
export default function PrintMail() {
  return (
    <div className="print">
      <PrintBar title="Demo mail for Rewind">
        Print at 100% on letter paper. Cut out the postcard, hold it and the
        statement in view, and tap <b>Scan mail</b> on the phone. The postcard
        lands in Letters; the bill lands on the calendar. Separate pages:{' '}
        <a href="/print/postcard">postcard</a> · <a href="/print/bill">bill</a>.
      </PrintBar>
      <main className="sheet">
        <PostcardMessageSide />
        <PostcardPictureSide />
      </main>
      <main className="sheet sheet-stmt">
        <MedicalStatement />
      </main>
    </div>
  );
}
