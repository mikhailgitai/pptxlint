import { buildRawZip } from "./raw-zip.js";
import type { RawZipEntry } from "./raw-zip.js";

export const PRESENTATIONML_NAMESPACE =
  "http://schemas.openxmlformats.org/presentationml/2006/main";
export const DRAWINGML_NAMESPACE =
  "http://schemas.openxmlformats.org/drawingml/2006/main";
export const OFFICE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const PACKAGE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";

export interface MinimalPptxOptions {
  readonly slideXml?: string;
  /** Appended verbatim, so duplicate part names can be built intentionally. */
  readonly additionalEntries?: readonly RawZipEntry[];
}

/** Returns deterministic bytes for a one-slide, structurally minimal PPTX. */
export function buildMinimalPptx(options: MinimalPptxOptions = {}): Uint8Array {
  return buildRawZip([
    ...minimalPptxEntries(options.slideXml ?? minimalSlideXml()),
    ...(options.additionalEntries ?? []),
  ]);
}

export function minimalPptxEntries(slideXml: string): readonly RawZipEntry[] {
  return [
    { name: "[Content_Types].xml", data: CONTENT_TYPES_XML },
    { name: "_rels/.rels", data: ROOT_RELATIONSHIPS_XML },
    { name: "ppt/presentation.xml", data: PRESENTATION_XML },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: PRESENTATION_RELATIONSHIPS_XML,
    },
    { name: "ppt/presProps.xml", data: PRESENTATION_PROPERTIES_XML },
    { name: "ppt/slideMasters/slideMaster1.xml", data: SLIDE_MASTER_XML },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: SLIDE_MASTER_RELATIONSHIPS_XML,
    },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: SLIDE_LAYOUT_XML },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      data: SLIDE_LAYOUT_RELATIONSHIPS_XML,
    },
    { name: "ppt/slides/slide1.xml", data: slideXml },
    {
      name: "ppt/slides/_rels/slide1.xml.rels",
      data: SLIDE_RELATIONSHIPS_XML,
    },
    { name: "ppt/theme/theme1.xml", data: THEME_XML },
  ];
}

/** Raw extension XML is placed inside p:extLst for forward-compatibility tests. */
export function minimalSlideXml(extensionXml = ""): string {
  const extensionList =
    extensionXml === ""
      ? ""
      : `<p:extLst><p:ext uri="urn:pptxlint:fixture">${extensionXml}</p:ext></p:extLst>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="${DRAWINGML_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIPS_NAMESPACE}" xmlns:p="${PRESENTATIONML_NAMESPACE}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm/></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
  ${extensionList}
</p:sld>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`;

const ROOT_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

const PRESENTATION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:a="${DRAWINGML_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIPS_NAMESPACE}" xmlns:p="${PRESENTATIONML_NAMESPACE}">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle/>
</p:presentation>`;

const PRESENTATION_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>
</Relationships>`;

const PRESENTATION_PROPERTIES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<p:presentationPr xmlns:p="${PRESENTATIONML_NAMESPACE}"/>`;

const SLIDE_MASTER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<p:sldMaster xmlns:a="${DRAWINGML_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIPS_NAMESPACE}" xmlns:p="${PRESENTATIONML_NAMESPACE}">
  <p:cSld name="Minimal Master">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm/></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`;

const SLIDE_MASTER_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const SLIDE_LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<p:sldLayout xmlns:a="${DRAWINGML_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIPS_NAMESPACE}" xmlns:p="${PRESENTATIONML_NAMESPACE}" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm/></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

const SLIDE_LAYOUT_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const SLIDE_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

const THEME_XML = `<?xml version="1.0" encoding="UTF-8"?>
<a:theme xmlns:a="${DRAWINGML_NAMESPACE}" name="pptxlint Minimal">
  <a:themeElements>
    <a:clrScheme name="pptxlint Minimal">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F2937"/></a:dk2>
      <a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>
      <a:accent1><a:srgbClr val="2563EB"/></a:accent1>
      <a:accent2><a:srgbClr val="DC2626"/></a:accent2>
      <a:accent3><a:srgbClr val="16A34A"/></a:accent3>
      <a:accent4><a:srgbClr val="9333EA"/></a:accent4>
      <a:accent5><a:srgbClr val="0891B2"/></a:accent5>
      <a:accent6><a:srgbClr val="D97706"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="pptxlint Minimal">
      <a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="pptxlint Minimal">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
</a:theme>`;
