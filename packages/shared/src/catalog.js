const publicDomain = ['Public domain', 'https://creativecommons.org/publicdomain/mark/1.0/'];
const creativeCommons = ['CC BY 3.0', 'https://creativecommons.org/licenses/by/3.0/'];
const ccBy4 = ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'];
const ccByNd4 = ['CC BY-ND 4.0', 'https://creativecommons.org/licenses/by-nd/4.0/'];

function stream(archive, file, captions, segments) {
  return { archive, file, captions, segments };
}

function title({ key, id, name, year, genre, duration, description, credit, media, ...options }) {
  const type = options.episodes ? 'tv' : 'movie';
  return {
    key, id, title: name, year, genre, duration, description, credit, media, type,
    poster: `/art/${key}.jpg`, backdrop: `/art/${key}-wide.jpg`,
    license: publicDomain, ...options,
  };
}

export const archiveCatalog = [
  title({
    key: 'nosferatu', id: 653, name: 'Nosferatu', year: 1922, genre: 'Horror', duration: 92,
    description: 'A young estate agent travels to a remote castle and unwittingly brings Count Orlok’s shadow back to his hometown.',
    credit: 'Directed by F. W. Murnau', media: stream('Nosferatu1922', 'Nosferatu.mp4'),
    license: ['CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'],
  }),
  title({
    key: 'night', id: 10331, name: 'Night of the Living Dead', year: 1968, genre: 'Horror', duration: 96,
    description: 'As the dead rise across rural Pennsylvania, seven strangers barricade themselves inside a farmhouse and try to survive until morning.',
    credit: 'Directed by George A. Romero', media: stream('Night.Of.The.Living.Dead_1080p', 'NightOfTheLivingDead_1080p.mp4'),
  }),
  title({
    key: 'charade', id: 4808, name: 'Charade', year: 1963, genre: 'Mystery', duration: 113,
    description: 'After her husband’s murder, a woman in Paris is pursued by three men and turns to a charming stranger whose story keeps changing.',
    credit: 'Directed by Stanley Donen', media: stream('charade-1963-cary-grant-audrey-hepburn-comedy-mystery-romance-thriller-full-movie', 'Charade_READY.mp4'),
  }),
  title({
    key: 'general', id: 961, name: 'The General', year: 1926, genre: 'Comedy', duration: 67,
    description: 'When Union spies steal his locomotive, a railway engineer sets off on a chase behind enemy lines.',
    credit: 'Directed by Buster Keaton and Clyde Bruckman', media: stream('TheGeneral', 'The_General_512kb.mp4'),
  }),
  title({
    key: 'friday', id: 3085, name: 'His Girl Friday', year: 1940, genre: 'Comedy', duration: 88,
    description: 'A newspaper editor tries to win back his star reporter and ex-wife by drawing her into one last scoop.',
    credit: 'Directed by Howard Hawks', media: stream('HisGirlFriday', 'MoviePowderPresentsHisGirlFriday.mp4'),
  }),
  title({
    key: 'sintel', id: 45745, name: 'Sintel', year: 2010, genre: 'Animation', duration: 15,
    description: 'A young wanderer journeys across a harsh landscape in search of the dragon she once rescued.',
    credit: 'Blender Foundation · Directed by Colin Levy', media: stream('Sintel', 'sintel-2048-stereo.mp4'),
    license: creativeCommons,
  }),
  title({
    key: 'carnival', id: 16093, name: 'Carnival of Souls', year: 1962, genre: 'Horror', duration: 83,
    description: 'After surviving a car crash, an organist feels drawn to an abandoned pavilion and begins seeing a strange figure.',
    credit: 'Directed by Herk Harvey', media: stream('CarnivalofSouls', 'CarnivalOfSouls.mp4'),
  }),
  title({
    key: 'sherlock', id: 992, name: 'Sherlock Jr.', year: 1924, genre: 'Comedy', duration: 45,
    description: 'A movie projectionist dreams his way into the film he’s screening and becomes the detective he’s always wanted to be.',
    credit: 'Directed by Buster Keaton', media: stream('sherlock-jr_202506', 'Sherlock Jr.mp4'),
  }),
  title({
    key: 'bunny', id: 10378, name: 'Big Buck Bunny', year: 2008, genre: 'Animation', duration: 10,
    description: 'A gentle rabbit has a change of heart after a trio of forest bullies ruins his morning.',
    credit: 'Blender Foundation · Directed by Sacha Goedegebure', media: stream('BigBuckBunny_124', 'Content/big_buck_bunny_720p_surround.mp4'),
    license: creativeCommons,
  }),
  title({
    key: 'steel', id: 133701, name: 'Tears of Steel', year: 2012, genre: 'Science Fiction', duration: 12,
    description: 'Scientists in a robot-ravaged Amsterdam try to undo a mistake from the past before the city is overrun.',
    credit: 'Blender Foundation · Directed by Ian Hubert', media: stream('Tears-of-Steel', 'tears_of_steel_720p.mp4'),
    license: creativeCommons,
  }),
  title({
    key: 'doa', id: 18995, name: 'D.O.A.', year: 1949, genre: 'Film Noir', duration: 83,
    description: 'A man discovers he has been fatally poisoned and races to find out who killed him and why.',
    credit: 'Directed by Rudolph Maté', media: stream('doa_ipod', 'doa.mp4'),
  }),
  title({
    key: 'elephants', id: 9761, name: 'Elephants Dream', year: 2006, genre: 'Animation', duration: 11,
    description: 'Two companions explore a sprawling machine that seems to have a life of its own.',
    credit: 'Blender Foundation and Netherlands Media Art Institute', media: stream('ElephantsDream', 'ed_1024.mp4'),
    license: ['CC BY 3.0 US', 'https://creativecommons.org/licenses/by/3.0/us/'],
  }),
  title({
    key: 'spring', id: null, name: 'Spring', year: 2019, genre: 'Animation', duration: 8,
    description: 'A shepherd and her dog face ancient spirits as the seasons change.',
    credit: 'Blender Foundation', media: stream('springopenmovie', 'springopenmovie.ia.mp4'),
    poster: '/art/spring.webp', backdrop: '/art/spring.webp', license: ccBy4,
  }),
  title({
    key: 'charge', id: 1062079, name: 'Charge', year: 2022, genre: 'Animation', duration: 4,
    description: 'An old man breaks into a battery factory and comes face to face with a security droid.',
    credit: 'Blender Foundation', media: stream('charge_202601', 'Charge.ia.mp4'),
    poster: '/art/charge.webp', backdrop: '/art/charge.webp', license: ccByNd4, categories: ['Animation', 'Science Fiction'],
  }),
  title({
    key: 'sprite', id: 891761, name: 'Sprite Fright', year: 2021, genre: 'Animation', duration: 10,
    description: 'A group of teenagers ventures into a forest and discovers what its mushroom inhabitants are capable of.',
    credit: 'Blender Foundation', media: stream('sprite-fright-2021', 'Sprite Fright (2021).mp4'),
    poster: '/art/sprite.webp', backdrop: '/art/sprite.webp', license: ccBy4, categories: ['Animation', 'Horror', 'Comedy'],
  }),
  title({
    key: 'coffee', id: 717986, name: 'Coffee Run', year: 2020, genre: 'Animation', duration: 3,
    description: 'A woman runs through bittersweet memories of a past relationship.',
    credit: 'Blender Foundation', media: stream('coffee-run', 'Coffee Run.ia.mp4'),
    poster: '/art/coffee.webp', backdrop: '/art/coffee.webp', license: ccByNd4,
  }),
  title({
    key: 'wing', id: 1177628, name: 'Wing It!', year: 2023, genre: 'Animation', duration: 4,
    description: 'An uptight engineer and an eager would-be pilot launch themselves into an out-of-control space shuttle.',
    credit: 'Blender Foundation', media: stream('wing_it', 'wing_it.ia.mp4'),
    poster: '/art/wing.webp', backdrop: '/art/wing.webp', license: ccBy4, categories: ['Animation', 'Comedy'],
  }),
  title({
    key: 'moon', id: 775, name: 'A Trip to the Moon', year: 1902, genre: 'Science Fiction', duration: 13,
    description: 'A group of astronomers fires a capsule at the Moon and encounters its inhabitants.',
    credit: 'Directed by Georges Méliès',
    media: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/6/6d/Le_Voyage_dans_la_Lune_%281902%29.webm/Le_Voyage_dans_la_Lune_%281902%29.webm.480p.vp9.webm',
      source: 'Wikimedia Commons', page: 'https://commons.wikimedia.org/wiki/File:Le_Voyage_dans_la_Lune_(1902).webm',
    },
    poster: '/art/moon-wide.jpg', categories: ['Adventure', 'Fantasy'],
  }),
  title({
    key: 'train', id: 5698, name: 'The Great Train Robbery', year: 1903, genre: 'Western', duration: 13,
    description: 'A gang holds up a train and flees with the loot while a posse gives chase.',
    credit: 'Directed by Edwin S. Porter',
    media: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/d/d7/The_Great_Train_Robbery_%281903%29.webm/The_Great_Train_Robbery_%281903%29.webm.480p.vp9.webm',
      source: 'Wikimedia Commons', page: 'https://commons.wikimedia.org/wiki/File:The_Great_Train_Robbery_(1903).webm',
    },
    poster: '/art/train-wide.jpg', categories: ['Crime', 'Action'],
  }),
  title({
    key: 'step', id: 10377, name: 'One Step Beyond', year: 1959, genre: 'Mystery', duration: 25,
    description: 'John Newland hosts a supernatural anthology built around stories of strange and unexplained events.',
    credit: 'Hosted by John Newland', media: null,
    episodes: [
      { key: 'bride', title: 'The Bride Possessed', number: 1, season: 1, duration: 25, media: stream('OSB-TheBridePossessed', 'The_Bride_Possessed.mp4') },
      { key: 'dream', title: 'The Dream', number: 7, season: 1, duration: 25, media: stream('OSB-07_The_Dream', 'OSB-07_The_Dream.mp4', '/art/step-dream.vtt', [{ kind: 'intro', start: 0, end: 29 }]) },
    ],
  }),
  title({
    key: 'lone', id: 31179, name: 'The Lone Ranger', year: 1949, genre: 'Western', duration: null,
    description: 'A masked Texas Ranger and his companion Tonto ride across the Old West, taking on outlaws and helping the people they meet.',
    credit: 'Starring Clayton Moore and Jay Silverheels', media: null,
    episodes: [
      { key: 'enter', title: 'Enter the Lone Ranger', number: 1, season: 1, duration: 69, media: stream('enter_the_lone_ranger', 'enter_the_lone_ranger.mp4', '/art/lone-episode.vtt', [{ kind: 'intro', start: 0, end: 26 }]) },
    ],
  }),
  title({
    key: 'dragnet', id: 3716, name: 'Dragnet', year: 1951, genre: 'Crime', duration: 26,
    description: 'Sergeant Joe Friday investigates cases across Los Angeles in Jack Webb’s original police procedural.',
    credit: 'Created by Jack Webb', media: null,
    episodes: [
      { key: 'seventeen', title: 'The Big Seventeen', duration: 26, media: stream('TheBigSeventeen', 'drag_ep018_11-06-52_The_Big_Seventeen.mp4') },
    ],
  }),
];

export function archiveFileUrl(media) {
  if (media.url) return media.url;
  return `https://archive.org/download/${encodeURIComponent(media.archive)}/${media.file.split('/').map(encodeURIComponent).join('/')}`;
}
