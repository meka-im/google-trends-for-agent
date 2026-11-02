/** Country/region coverage for Google Trends Trending Now (not Explore subdivisions). */
const codes = 'AL DZ AO AR AM AU AT AZ BH BD BY BE BJ BO BA BR BG BF KH CM CA CL CO CR CI HR CU CY CZ DK DO EC EG SV EE ET FI FR GE DE GH GR GT HT HN HK HU IN ID IR IQ IE IL IT JM JP JO KZ KE KW KG LV LB LY LT MK MY ML MX MD MA MZ MM NP NL NZ NI NG NO OM PK PA PY PE PH PL PT PR QA RO RU SA SN RS SG SK SI ZA KR ES LK SE CH TW TZ TH TN TR UG UA AE GB US UY UZ VE VN YE ZM ZW'.split(' ');
const names = new Intl.DisplayNames(['en'], { type: 'region' });
export const TRENDING_GEOS: { code: string; name: string }[] = codes.map(code => ({
  code, name: code === 'KR' ? 'South Korea' : names.of(code) ?? code,
}));
/** A broad selection; prefer a few relevant geos for interactive use. */
export const DEFAULT_TRENDING_GEOS = 'US SG JP GB DE FR IN BR CA AU KR ID MY PH TH VN TW HK MX AR ZA NG EG SA AE TR IT ES NL SE'.split(' ')
  .map(code => TRENDING_GEOS.find(geo => geo.code === code)!);
