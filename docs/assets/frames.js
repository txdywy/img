export const categories = [
  ['all', '全部'], ['classic', '素雅'], ['flowers', '花卉'], ['festival', '节庆'],
  ['travel', '旅行'], ['memory', '纪念'],
];

// caption: which words the frame can carry in its bottom border.
function frame(id, name, category, paper, ink, accent, detail, motif, caption = '') {
  return { id, name, category, paper, ink, accent, detail, motif, caption };
}

export const frames = [
  frame('family', '全家福', 'memory', '#fbf6ee', '#5d4636', '#c8b08f', '#8f7963', 'family'),
  frame('longevity', '福寿安康', 'festival', '#9b2a2c', '#f8d98f', '#e2b65c', '#c4473f', 'longevity', 'blessing'),
  frame('trip', '出游纪念', 'travel', '#f6f0e3', '#3f5968', '#c9573f', '#3f6f9a', 'trip', 'travel'),
  frame('azalea', '花开富贵', 'flowers', '#fff4e8', '#944253', '#d56c83', '#62765c', 'peony'),
  frame('ivory', '奶油留白', 'classic', '#fff7e9', '#987c5e', '#dbcbb0', '#c0a481', 'plain'),
  frame('jade', '青瓷如意', 'classic', '#e2eee5', '#41675a', '#8da699', '#b2c7b1', 'lattice'),
  frame('gold', '鎏金岁月', 'memory', '#f7e5ba', '#7b4d25', '#bc8d46', '#edc976', 'gilt'),
  frame('rose', '蔷薇小院', 'flowers', '#fff0f0', '#82465c', '#bb6083', '#677653', 'rose'),
  frame('postcard', '山水来信', 'travel', '#eaf2f0', '#4b6b66', '#779490', '#bdcfc6', 'mountain'),
  frame('cherry', '樱花细语', 'flowers', '#fdf1ed', '#9e5761', '#d0808f', '#a4715f', 'blossom'),
  frame('lotus', '荷塘月色', 'flowers', '#edf1e9', '#466b68', '#b97f97', '#64917b', 'lotus'),
  frame('plum', '梅开五福', 'flowers', '#fff0e8', '#974454', '#ba4864', '#5b3a2c', 'plum'),
  frame('osmanthus', '桂香满园', 'flowers', '#fff0cf', '#795726', '#ce9428', '#6b7745', 'osmanthus'),
  frame('camellia', '山茶花开', 'flowers', '#f9e8dc', '#7b3849', '#b34c64', '#427158', 'rose'),
  frame('magnolia', '玉兰清芬', 'flowers', '#f2efef', '#655669', '#c59ba9', '#656d5a', 'lotus'),
  frame('rice', '米纸细边', 'classic', '#f5efdf', '#796a52', '#c8b895', '#9e8d70', 'paper'),
  frame('walnut', '胡桃木框', 'classic', '#a67a54', '#4e3023', '#75503a', '#cfaa81', 'wood'),
  frame('ink', '墨色细边', 'classic', '#383637', '#e5ddd0', '#807673', '#a39a8f', 'double'),
  frame('blush', '豆沙细边', 'classic', '#f3dbdd', '#924f5c', '#cd9ca3', '#e6c2c5', 'double'),
  frame('bamboo', '竹影清风', 'classic', '#ebefdf', '#4c6448', '#8ea34f', '#5f7b59', 'bamboo'),
  frame('silver', '银灰画框', 'classic', '#ececec', '#57595d', '#aaa9ae', '#cbcacb', 'double'),
  frame('red', '吉祥中国红', 'festival', '#a72436', '#fff1c3', '#ffcc68', '#d76459', 'lattice'),
  frame('lantern', '灯火团圆', 'festival', '#8b2333', '#fff0c4', '#f6b255', '#d76052', 'lantern'),
  frame('moon', '花好月圆', 'festival', '#293b61', '#fff0bd', '#e8ba69', '#8796b1', 'moon'),
  frame('lantern-blue', '元夕花灯', 'festival', '#2f5263', '#ffe8b8', '#ffc470', '#b96a62', 'lantern'),
  frame('birthday', '生日快乐', 'festival', '#f9e2df', '#903e59', '#d56c83', '#bf873f', 'confetti', 'birthday'),
  frame('double-happiness', '喜事成双', 'festival', '#8e2330', '#fbe6ac', '#dfac50', '#f27761', 'gilt'),
  frame('autumn', '秋日远足', 'travel', '#f2e2c8', '#755038', '#b16a41', '#7a7555', 'mountain'),
  frame('sea', '海风假日', 'travel', '#dbeef0', '#38636d', '#719fa7', '#6ab0ba', 'waves'),
  frame('west-lake', '江南烟雨', 'travel', '#e4ede7', '#395c58', '#87a798', '#90aaa4', 'waves'),
  frame('country', '乡间散步', 'travel', '#f7ecd2', '#5d6338', '#a7a06b', '#947e48', 'paper'),
  frame('journey', '旅途明信片', 'travel', '#f7eadf', '#855548', '#c38372', '#6f858b', 'postmark'),
  frame('album', '旧时相册', 'memory', '#f0dfc4', '#69513e', '#a88662', '#d1b38a', 'album'),
  frame('lace', '珍珠花边', 'memory', '#f4e6ee', '#7b5268', '#c296ad', '#ead1df', 'lace'),
  frame('time', '金色年华', 'memory', '#493528', '#f6db9f', '#d7a959', '#86674a', 'gilt'),
  frame('warm', '暖调拍立得', 'memory', '#fff4e4', '#806857', '#c3aa91', '#e3d2b6', 'instant'),
  frame('film', '光阴胶片', 'memory', '#343237', '#e7decf', '#a4a1a3', '#66616c', 'film'),
  frame('letters', '家书一页', 'memory', '#f6ebdc', '#7a5343', '#b3886e', '#ac6960', 'postmark'),
  frame('silk', '锦绣团圆', 'festival', '#6f2c43', '#fae2b8', '#dba56c', '#a96573', 'lace'),
];

export const byId = new Map(frames.map(item => [item.id, item]));
