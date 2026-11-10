// Common handmade product types and the US codes makers usually choose between.
//
// These are starting points, not rulings: the maker reads the legal wording of
// each suggestion and confirms the one that describes their product. Every
// code here is checked by a test against the bundled tariff data.

export type Watch = 'children' | 'cosmetics' | 'food' | 'wood' | 'textiles' | 'jewellery';

export interface Candidate {
  code: string;
  /** When this code is the right one, in plain words. */
  when: string;
}

export interface Category {
  id: string;
  name: string;
  group: string;
  candidates: Candidate[];
  watch?: Watch[];
}

export const WATCH_NOTES: Record<Watch, string> = {
  children:
    'Toys and anything made for children under 12 are checked more closely: the US expects a Children\'s Product Certificate, tracking labels and lead and small-parts limits. Royal Mail warned of extra US checks on toys and children\'s products from 22 Oct 2026.',
  cosmetics:
    'Skincare, bath products and fragrances count as cosmetics in the US (FDA rules on labels and ingredients). Royal Mail warned of extra US checks on cosmetics from 22 Oct 2026. Plain soap sold only as soap is treated differently.',
  food:
    'Food sent to the US needs FDA prior notice, and the maker may need an FDA food facility registration. Check before you offer US postage.',
  wood:
    'Some wooden goods need a plant-origin (Lacey Act) declaration on entry. Check whether your product type is covered.',
  textiles:
    'US textile rules expect a label with fibre content and country of origin ("Made in the UK").',
  jewellery:
    'Jewellery for children has US lead and cadmium limits.',
};

export const CATEGORIES: Category[] = [
  // Jewellery
  { id: 'jewel-silver', name: 'Silver jewellery (rings, earrings, pendants)', group: 'Jewellery', watch: ['jewellery'], candidates: [
    { code: '7113.11.50.00', when: 'Silver pieces, usual case' },
    { code: '7113.11.20.00', when: 'Only if valued at $18 or less per dozen pieces' },
    { code: '7113.11.10.00', when: 'Silver chain sold by length (rope, curb, cable)' },
  ] },
  { id: 'jewel-gold', name: 'Gold jewellery', group: 'Jewellery', watch: ['jewellery'], candidates: [
    { code: '7113.19.50.91', when: 'Gold rings, earrings, bracelets, pendants' },
    { code: '7113.19.29.90', when: 'Gold necklaces and neck chains' },
  ] },
  { id: 'jewel-plated', name: 'Gold-filled or rolled-gold jewellery (base metal clad with precious metal)', group: 'Jewellery', watch: ['jewellery'], candidates: [
    { code: '7113.20.50.00', when: 'Pieces other than chain and clasps' },
    { code: '7113.20.29.00', when: 'Necklaces and neck chains clad with gold' },
  ] },
  { id: 'jewel-costume', name: 'Brass, copper or plated base-metal jewellery', group: 'Jewellery', watch: ['jewellery'], candidates: [
    { code: '7117.19.90.00', when: 'Base metal, whether or not plated (gold-plated brass, copper)' },
    { code: '7117.11.00.00', when: 'Cufflinks and studs' },
  ] },
  { id: 'jewel-beaded', name: 'Beaded, glass, ceramic, wood or fabric jewellery', group: 'Jewellery', watch: ['jewellery'], candidates: [
    { code: '7117.90.90.00', when: 'Glass, ceramic, wood, fabric or mixed materials' },
    { code: '7117.90.75.00', when: 'Made of plastic or resin' },
  ] },

  // Bags and accessories
  { id: 'bag-tote-cotton', name: 'Cotton tote or shopping bag', group: 'Bags and accessories', watch: ['textiles'], candidates: [
    { code: '4202.92.15.00', when: 'Cotton tote, plain woven (not pile or tufted)' },
    { code: '4202.92.33.16', when: 'Cotton tote of pile or tufted fabric (such as corduroy or velvet)' },
    { code: '4202.22.45.00', when: 'Cotton handbag (a bag carried as a handbag rather than a tote)' },
    { code: '4202.22.89.30', when: 'Cotton handbag of pile or tufted fabric' },
  ] },
  { id: 'bag-textile-other', name: 'Bags of other fabric (polyester, wool, felt)', group: 'Bags and accessories', watch: ['textiles'], candidates: [
    { code: '4202.92.31.31', when: 'Synthetic fabric tote, travel or sports bag' },
    { code: '4202.92.20.00', when: 'Linen, jute or hemp tote (not pile or tufted)' },
    { code: '4202.22.81.00', when: 'Synthetic fabric handbag' },
  ] },
  { id: 'leather-wallet', name: 'Leather wallets, purses, card holders', group: 'Bags and accessories', candidates: [
    { code: '4202.31.60.00', when: 'Pocket items of leather' },
  ] },
  { id: 'leather-handbag', name: 'Leather handbags', group: 'Bags and accessories', candidates: [
    { code: '4202.21.90.00', when: 'Valued over $20 each' },
    { code: '4202.21.60.00', when: 'Valued $20 or less each' },
  ] },
  { id: 'leather-belt', name: 'Leather belts', group: 'Bags and accessories', candidates: [
    { code: '4203.30.00.00', when: 'Belts with or without buckles' },
  ] },
  { id: 'leather-small', name: 'Leather keyrings and small leather goods', group: 'Bags and accessories', candidates: [
    { code: '4205.00.80.00', when: 'Other articles of leather' },
  ] },
  { id: 'pet-collar', name: 'Dog collars and leads', group: 'Bags and accessories', candidates: [
    { code: '4201.00.30.00', when: 'Leashes, collars and harnesses (any material)' },
  ] },
  { id: 'hair-accessories', name: 'Scrunchies and fabric headbands', group: 'Bags and accessories', watch: ['textiles'], candidates: [
    { code: '6117.80.85.00', when: 'Knitted or crocheted' },
    { code: '9615.19.60.00', when: 'Hair slides and clips (not plastic)' },
  ] },

  // Knitting and sewing
  { id: 'knit-scarf', name: 'Knitted or crocheted scarves and shawls', group: 'Knitwear and clothing', watch: ['textiles'], candidates: [
    { code: '6117.10.10.00', when: 'Of wool or fine animal hair' },
    { code: '6117.10.60.10', when: 'Of cotton' },
    { code: '6117.10.20.30', when: 'Of acrylic or other man-made fibres' },
  ] },
  { id: 'knit-hat', name: 'Knitted or crocheted hats', group: 'Knitwear and clothing', watch: ['textiles'], candidates: [
    { code: '6505.00.30.90', when: 'Of wool (adult)' },
    { code: '6505.00.30.30', when: 'Of wool, for babies' },
    { code: '6505.00.15.40', when: 'Of cotton (adult)' },
    { code: '6505.00.60.90', when: 'Of acrylic or other man-made fibres' },
  ] },
  { id: 'knit-sweater', name: 'Knitted wool jumpers and cardigans', group: 'Knitwear and clothing', watch: ['textiles'], candidates: [
    { code: '6110.11.00.30', when: "Women's wool sweater" },
    { code: '6110.11.00.15', when: "Men's wool sweater" },
  ] },
  { id: 'baby-clothes', name: 'Knitted baby clothes (cotton)', group: 'Knitwear and clothing', watch: ['textiles', 'children'], candidates: [
    { code: '6111.20.30.00', when: 'Cardigans, jumpers' },
    { code: '6111.20.60.50', when: 'Socks and booties' },
    { code: '6111.20.60.70', when: 'Other baby garments' },
  ] },
  { id: 'apron', name: 'Aprons (cotton)', group: 'Knitwear and clothing', watch: ['textiles'], candidates: [
    { code: '6211.42.10.92', when: "Women's or unisex cotton garment, other" },
  ] },

  // Homeware
  { id: 'blanket', name: 'Blankets and throws', group: 'Home textiles', watch: ['textiles'], candidates: [
    { code: '6301.20.00.10', when: 'Of wool, up to 3 m long' },
  ] },
  { id: 'quilt', name: 'Quilts', group: 'Home textiles', watch: ['textiles'], candidates: [
    { code: '9404.40.10.00', when: 'Of cotton, no embroidery, lace or appliqué' },
    { code: '9404.40.90.05', when: 'Cotton shell with embroidery or other trim' },
  ] },
  { id: 'cushion-cover', name: 'Cushion covers and table runners (cotton)', group: 'Home textiles', watch: ['textiles'], candidates: [
    { code: '6304.92.00.00', when: 'Woven cotton furnishing article' },
  ] },
  { id: 'tea-towel', name: 'Tea towels (cotton)', group: 'Home textiles', watch: ['textiles'], candidates: [
    { code: '6302.91.00.45', when: 'Cotton dish towels, flat woven' },
  ] },
  { id: 'macrame', name: 'Macramé and rope work', group: 'Home textiles', candidates: [
    { code: '5609.00.10.00', when: 'Of cotton cord' },
    { code: '5609.00.20.00', when: 'Of jute or other plant fibre' },
  ] },

  // Ceramics and glass
  { id: 'mug-stoneware', name: 'Stoneware or earthenware mugs', group: 'Ceramics and glass', candidates: [
    { code: '6912.00.44.00', when: 'Mugs (not porcelain or china)' },
  ] },
  { id: 'tableware-stoneware', name: 'Stoneware bowls, plates and jugs', group: 'Ceramics and glass', candidates: [
    { code: '6912.00.48.10', when: 'For food or drink, sold singly (not in sets)' },
    { code: '6912.00.10.00', when: 'Coarse-grained earthenware or stoneware' },
  ] },
  { id: 'porcelain', name: 'Porcelain or bone china tableware', group: 'Ceramics and glass', candidates: [
    { code: '6911.10.45.00', when: 'Porcelain mugs' },
    { code: '6911.10.25.00', when: 'Bone china, valued over $31.50 a dozen' },
    { code: '6911.10.80.10', when: 'Other porcelain for food or drink' },
  ] },
  { id: 'ceramic-decor', name: 'Ceramic ornaments, vases and planters', group: 'Ceramics and glass', candidates: [
    { code: '6913.90.50.00', when: 'Stoneware or earthenware ornaments' },
    { code: '6913.90.10.00', when: 'Statuettes and handmade flowers (check the value limit)' },
    { code: '6912.00.50.00', when: 'Plant pots and other household ceramics' },
  ] },
  { id: 'glass-decor', name: 'Fused or blown glass ornaments and dishes', group: 'Ceramics and glass', candidates: [
    { code: '7013.99.90.90', when: 'Decorative glassware valued over $5 each' },
    { code: '7013.49.60.90', when: 'Glass table dishes valued over $5 each' },
    { code: '7018.90.50.00', when: 'Small glass ornaments and lampwork' },
  ] },
  { id: 'stained-glass', name: 'Stained glass panels and suncatchers', group: 'Ceramics and glass', candidates: [
    { code: '7020.00.60.00', when: 'Other articles of glass' },
  ] },

  // Candles, soap, bath
  { id: 'candles', name: 'Candles and wax melts', group: 'Candles, soap and bath', candidates: [
    { code: '3406.00.00.00', when: 'Candles, tapers and the like' },
  ] },
  { id: 'soap', name: 'Handmade soap', group: 'Candles, soap and bath', watch: ['cosmetics'], candidates: [
    { code: '3401.11.50.00', when: 'Toilet soap in bars' },
  ] },
  { id: 'bath', name: 'Bath bombs and bath salts', group: 'Candles, soap and bath', watch: ['cosmetics'], candidates: [
    { code: '3307.30.50.00', when: 'Bath bombs and other bath preparations' },
    { code: '3307.30.10.00', when: 'Bath salts' },
  ] },
  { id: 'skincare', name: 'Balms, lotions and skincare', group: 'Candles, soap and bath', watch: ['cosmetics'], candidates: [
    { code: '3304.99.50.00', when: 'Beauty and skincare preparations' },
  ] },
  { id: 'room-scent', name: 'Reed diffusers and room sprays', group: 'Candles, soap and bath', watch: ['cosmetics'], candidates: [
    { code: '3307.49.00.00', when: 'Preparations for perfuming rooms' },
  ] },

  // Paper and art
  { id: 'cards', name: 'Greeting cards', group: 'Paper and art', candidates: [
    { code: '4909.00.40.00', when: 'Greeting cards (with or without envelopes)' },
    { code: '4909.00.20.00', when: 'Postcards' },
  ] },
  { id: 'prints', name: 'Art prints and posters', group: 'Paper and art', candidates: [
    { code: '4911.91.40.40', when: 'Digital or other printed pictures' },
    { code: '4911.91.20.40', when: 'Lithographs on paper up to 0.51 mm thick' },
  ] },
  { id: 'original-art', name: 'Original paintings and drawings', group: 'Paper and art', candidates: [
    { code: '9701.91.00.00', when: 'Executed entirely by hand' },
    { code: '9702.90.00.00', when: 'Original engravings, prints and lithographs' },
  ] },
  { id: 'notebooks', name: 'Notebooks and journals', group: 'Paper and art', candidates: [
    { code: '4820.10.20.60', when: 'Bound notebooks' },
  ] },

  // Wood and other
  { id: 'wood-kitchen', name: 'Wooden chopping boards and spoons', group: 'Wood, metal and other', watch: ['wood'], candidates: [
    { code: '4419.90.91.00', when: 'Boards, bowls and other kitchenware' },
    { code: '4419.90.11.00', when: 'Wooden forks and spoons' },
  ] },
  { id: 'wood-decor', name: 'Wood carvings and ornaments', group: 'Wood, metal and other', watch: ['wood'], candidates: [
    { code: '4420.19.00.00', when: 'Not of tropical wood' },
    { code: '4420.90.45.00', when: 'Wooden jewellery or trinket boxes, unlined' },
  ] },
  { id: 'frames', name: 'Wooden picture frames', group: 'Wood, metal and other', watch: ['wood'], candidates: [
    { code: '4414.90.00.00', when: 'Not of tropical wood' },
  ] },
  { id: 'baskets', name: 'Baskets (willow and other plant materials)', group: 'Wood, metal and other', candidates: [
    { code: '4602.19.12.00', when: 'Willow baskets' },
    { code: '4602.19.18.00', when: 'Other plant materials, not wickerwork' },
  ] },
  { id: 'resin', name: 'Resin coasters and ornaments', group: 'Wood, metal and other', candidates: [
    { code: '3926.40.00.90', when: 'Ornamental articles of plastic or resin' },
  ] },
  { id: 'metal-decor', name: 'Metal ornaments and keyrings', group: 'Wood, metal and other', candidates: [
    { code: '8306.29.00.00', when: 'Statuettes and ornaments of base metal' },
  ] },
  { id: 'christmas', name: 'Christmas decorations', group: 'Wood, metal and other', candidates: [
    { code: '9505.10.25.00', when: 'Christmas ornaments of fabric or other materials' },
    { code: '9505.10.15.00', when: 'Christmas ornaments of wood' },
    { code: '9505.10.10.00', when: 'Christmas ornaments of glass' },
  ] },
  { id: 'artificial-flowers', name: 'Fabric or paper flowers', group: 'Wood, metal and other', candidates: [
    { code: '6702.90.65.00', when: 'Of paper or natural fibres' },
    { code: '6702.90.35.00', when: 'Of man-made fibres' },
  ] },

  // Toys
  { id: 'soft-toys', name: 'Soft toys and crochet animals', group: 'Toys', watch: ['children'], candidates: [
    { code: '9503.00.00.73', when: 'For children aged 3 to 12' },
    { code: '9503.00.00.71', when: 'For babies and children under 3' },
    { code: '9503.00.00.90', when: 'Collectors’ pieces not meant for children' },
  ] },
  { id: 'wooden-toys', name: 'Wooden toys', group: 'Toys', watch: ['children', 'wood'], candidates: [
    { code: '9503.00.00.73', when: 'For children aged 3 to 12' },
    { code: '9503.00.00.71', when: 'For babies and children under 3' },
  ] },

  // Food
  { id: 'fudge', name: 'Fudge and sweets', group: 'Food', watch: ['food'], candidates: [
    { code: '1704.90.35.50', when: 'Retail-packed sweets without peanuts' },
  ] },
  { id: 'jam', name: 'Jams and preserves', group: 'Food', watch: ['food'], candidates: [
    { code: '2007.99.45.00', when: 'Jams not listed separately (mixed fruit, plum, etc.)' },
    { code: '2007.99.10.00', when: 'Strawberry jam' },
    { code: '2007.99.15.00', when: 'Currant and other berry jam' },
  ] },
];

export function categoryById(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function categoryGroups(): { group: string; items: Category[] }[] {
  const out: { group: string; items: Category[] }[] = [];
  for (const c of CATEGORIES) {
    let g = out.find((x) => x.group === c.group);
    if (!g) out.push((g = { group: c.group, items: [] }));
    g.items.push(c);
  }
  return out;
}
