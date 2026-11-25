const publicDomain = ['Public domain', 'https://creativecommons.org/publicdomain/mark/1.0/'];
const creativeCommons = ['CC BY 3.0', 'https://creativecommons.org/licenses/by/3.0/'];
const ccBy4 = ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'];
const ccByNd4 = ['CC BY-ND 4.0', 'https://creativecommons.org/licenses/by-nd/4.0/'];

function stream(archive, file, captions, segments) {
  return { archive, file, captions, segments };
}

function title(key, id, name, year, genre, duration, description, credit, media, options = {}) {
  const type = options.episodes ? 'tv' : 'movie';
  return {
    key, id, title: name, year, genre, duration, description, credit, media, type,
    poster: `/art/${key}.jpg`, backdrop: `/art/${key}-wide.jpg`,
    license: publicDomain, ...options,
  };
}

export const archiveCatalog = [
  title('nosferatu', 653, 'Nosferatu', 1922, 'Horror', 92,
    'A young estate agent travels to a remote castle and unwittingly brings Count Orlok’s shadow back to his hometown.',
    'Directed by F. W. Murnau', stream('Nosferatu1922', 'Nosferatu.mp4'),
    { license: ['CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'] }),
  title('night', 10331, 'Night of the Living Dead', 1968, 'Horror', 96,
    'As the dead rise across rural Pennsylvania, seven strangers barricade themselves inside a farmhouse and try to survive until morning.',
    'Directed by George A. Romero', stream('Night.Of.The.Living.Dead_1080p', 'NightOfTheLivingDead_1080p.mp4')),
  title('charade', 4808, 'Charade', 1963, 'Mystery', 113,
    'After her husband’s murder, a woman in Paris is pursued by three men and turns to a charming stranger whose story keeps changing.',
    'Directed by Stanley Donen', stream('charade-1963-cary-grant-audrey-hepburn-comedy-mystery-romance-thriller-full-movie', 'Charade_READY.mp4')),
  title('general', 961, 'The General', 1926, 'Comedy', 67,
    'When Union spies steal his locomotive, a railway engineer sets off on a chase behind enemy lines.',
    'Directed by Buster Keaton and Clyde Bruckman', stream('TheGeneral', 'The_General_512kb.mp4')),
  title('friday', 3085, 'His Girl Friday', 1940, 'Comedy', 88,
    'A newspaper editor tries to win back his star reporter and ex-wife by drawing her into one last scoop.',
    'Directed by Howard Hawks', stream('HisGirlFriday', 'MoviePowderPresentsHisGirlFriday.mp4')),
  title('sintel', 45745, 'Sintel', 2010, 'Animation', 15,
    'A young wanderer journeys across a harsh landscape in search of the dragon she once rescued.',
    'Blender Foundation · Directed by Colin Levy', stream('Sintel', 'sintel-2048-stereo.mp4'), { license: creativeCommons }),
  title('carnival', 16093, 'Carnival of Souls', 1962, 'Horror', 83,
    'After surviving a car crash, an organist feels drawn to an abandoned pavilion and begins seeing a strange figure.',
    'Directed by Herk Harvey', stream('CarnivalofSouls', 'CarnivalOfSouls.mp4')),
  title('sherlock', 992, 'Sherlock Jr.', 1924, 'Comedy', 45,
    'A movie projectionist dreams his way into the film he’s screening and becomes the detective he’s always wanted to be.',
    'Directed by Buster Keaton', stream('sherlock-jr_202506', 'Sherlock Jr.mp4')),
  title('bunny', 10378, 'Big Buck Bunny', 2008, 'Animation', 10,
    'A gentle rabbit has a change of heart after a trio of forest bullies ruins his morning.',
    'Blender Foundation · Directed by Sacha Goedegebure', stream('BigBuckBunny_124', 'Content/big_buck_bunny_720p_surround.mp4'), { license: creativeCommons }),
  title('steel', 133701, 'Tears of Steel', 2012, 'Science Fiction', 12,
    'Scientists in a robot-ravaged Amsterdam try to undo a mistake from the past before the city is overrun.',
    'Blender Foundation · Directed by Ian Hubert', stream('Tears-of-Steel', 'tears_of_steel_720p.mp4'), { license: creativeCommons }),
  title('doa', 18995, 'D.O.A.', 1949, 'Film Noir', 83,
    'A man discovers he has been fatally poisoned and races to find out who killed him and why.',
    'Directed by Rudolph Maté', stream('doa_ipod', 'doa.mp4')),
  title('elephants', 9761, 'Elephants Dream', 2006, 'Animation', 11,
    'Two companions explore a sprawling machine that seems to have a life of its own.',
    'Blender Foundation and Netherlands Media Art Institute', stream('ElephantsDream', 'ed_1024.mp4'),
    { license: ['CC BY 3.0 US', 'https://creativecommons.org/licenses/by/3.0/us/'] }),
  title('spring', null, 'Spring', 2019, 'Animation', 8,
    'A shepherd and her dog face ancient spirits as the seasons change.',
    'Blender Foundation', stream('springopenmovie', 'springopenmovie.ia.mp4'),
    { poster: '/art/spring.webp', backdrop: '/art/spring.webp', license: ccBy4 }),
  title('charge', 1062079, 'Charge', 2022, 'Animation', 4,
    'An old man breaks into a battery factory and comes face to face with a security droid.',
    'Blender Foundation', stream('charge_202601', 'Charge.ia.mp4'),
    { poster: '/art/charge.webp', backdrop: '/art/charge.webp', license: ccByNd4, categories: ['Animation', 'Science Fiction'] }),
  title('sprite', 891761, 'Sprite Fright', 2021, 'Animation', 10,
    'A group of teenagers ventures into a forest and discovers what its mushroom inhabitants are capable of.',
    'Blender Foundation', stream('sprite-fright-2021', 'Sprite Fright (2021).mp4'),
    { poster: '/art/sprite.webp', backdrop: '/art/sprite.webp', license: ccBy4, categories: ['Animation', 'Horror', 'Comedy'] }),
  title('coffee', 717986, 'Coffee Run', 2020, 'Animation', 3,
    'A woman runs through bittersweet memories of a past relationship.',
    'Blender Foundation', stream('coffee-run', 'Coffee Run.ia.mp4'),
    { poster: '/art/coffee.webp', backdrop: '/art/coffee.webp', license: ccByNd4 }),
  title('wing', 1177628, 'Wing It!', 2023, 'Animation', 4,
    'An uptight engineer and an eager would-be pilot launch themselves into an out-of-control space shuttle.',
    'Blender Foundation', stream('wing_it', 'wing_it.ia.mp4'),
    { poster: '/art/wing.webp', backdrop: '/art/wing.webp', license: ccBy4, categories: ['Animation', 'Comedy'] }),
  title('moon', 775, 'A Trip to the Moon', 1902, 'Science Fiction', 13,
    'A group of astronomers fires a capsule at the Moon and encounters its inhabitants.', 'Directed by Georges Méliès', {
      url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/6/6d/Le_Voyage_dans_la_Lune_%281902%29.webm/Le_Voyage_dans_la_Lune_%281902%29.webm.480p.vp9.webm',
      source: 'Wikimedia Commons', page: 'https://commons.wikimedia.org/wiki/File:Le_Voyage_dans_la_Lune_(1902).webm',
    }, { poster: '/art/moon-wide.jpg', categories: ['Adventure', 'Fantasy'] }),
  title('train', 5698, 'The Great Train Robbery', 1903, 'Western', 13,
    'A gang holds up a train and flees with the loot while a posse gives chase.', 'Directed by Edwin S. Porter', {
      url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/d/d7/The_Great_Train_Robbery_%281903%29.webm/The_Great_Train_Robbery_%281903%29.webm.480p.vp9.webm',
      source: 'Wikimedia Commons', page: 'https://commons.wikimedia.org/wiki/File:The_Great_Train_Robbery_(1903).webm',
    }, { poster: '/art/train-wide.jpg', categories: ['Crime', 'Action'] }),
  title('step', 10377, 'One Step Beyond', 1959, 'Mystery', 25,
    'John Newland hosts a supernatural anthology built around stories of strange and unexplained events.',
    'Hosted by John Newland', null, { episodes: [
      { key: 'bride', title: 'The Bride Possessed', number: 1, season: 1, duration: 25, media: stream('OSB-TheBridePossessed', 'The_Bride_Possessed.mp4') },
      { key: 'dream', title: 'The Dream', number: 7, season: 1, duration: 25, media: stream('OSB-07_The_Dream', 'OSB-07_The_Dream.mp4', '/art/step-dream.vtt', [{ kind: 'intro', start: 0, end: 29 }]) },
    ] }),
  title('lone', 31179, 'The Lone Ranger', 1949, 'Western', null,
    'A masked Texas Ranger and his companion Tonto ride across the Old West, taking on outlaws and helping the people they meet.',
    'Starring Clayton Moore and Jay Silverheels', null, { episodes: [
      { key: 'enter', title: 'Enter the Lone Ranger', number: 1, season: 1, duration: 69, media: stream('enter_the_lone_ranger', 'enter_the_lone_ranger.mp4', '/art/lone-episode.vtt', [{ kind: 'intro', start: 0, end: 26 }]) },
    ] }),
  title('dragnet', 3716, 'Dragnet', 1951, 'Crime', 26,
    'Sergeant Joe Friday investigates cases across Los Angeles in Jack Webb’s original police procedural.',
    'Created by Jack Webb', null, { episodes: [
      { key: 'seventeen', title: 'The Big Seventeen', duration: 26, media: stream('TheBigSeventeen', 'drag_ep018_11-06-52_The_Big_Seventeen.mp4') },
    ] }),
];

export function archiveFileUrl(media) {
  if (media.url) return media.url;
  return `https://archive.org/download/${encodeURIComponent(media.archive)}/${media.file.split('/').map(encodeURIComponent).join('/')}`;
}
