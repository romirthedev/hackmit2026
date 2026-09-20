'use client';
import { MedicalStatement, PrintBar } from '../mail';

export default function PrintBill() {
  return (
    <div className="print">
      <PrintBar title="Patient statement from Maple Grove Family Medicine">
        A full-page statement. Print at 100% on letter paper; no cutting
        needed. The due date and amount are what the scan reads.
      </PrintBar>
      <main className="sheet sheet-stmt">
        <MedicalStatement />
      </main>
    </div>
  );
}
