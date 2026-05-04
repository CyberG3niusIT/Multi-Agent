interface Props { footer?: boolean }

export default function ClassifiedHeader({ footer = false }: Props) {
  return (
    <div className="classified-bar" role={footer ? 'contentinfo' : 'banner'}>
      {footer
        ? '◆◆◆ END OF FILE // RUFLO INTERNAL — DOSSIER.RUV.IO — UNCONTROLLED COPY ◆◆◆'
        : '◆◆◆ CLASSIFIED // RUFLO INTERNAL — DOSSIER.RUV.IO — HANDLE VIA APPROVED CHANNELS ◆◆◆'}
    </div>
  );
}
