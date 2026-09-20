'use client';
import { PostcardMessageSide, PostcardPictureSide, PrintBar } from '../mail';

export default function PrintPostcard() {
  return (
    <div className="print">
      <PrintBar title="Postcard from Emma">
        Print at 100% on letter paper and cut along the dotted line. The
        message side is the one to scan; the picture side is optional.
      </PrintBar>
      <main className="sheet">
        <PostcardMessageSide />
        <PostcardPictureSide />
      </main>
    </div>
  );
}
