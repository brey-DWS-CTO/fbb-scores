/**
 * The roasts written on draft night, 18 October 2026. The recap shows these
 * until the commissioner saves a new one for a team. Clearing a saved roast
 * shows the line the numbers write instead.
 *
 * Draft facts only (ages, clubs, clocks, keepers), so a later change to the
 * projections never makes one wrong.
 */
export const SEED_ROASTS: Readonly<Record<number, Readonly<Record<string, string>>>> = {
  2027: {
    Ryan: 'Drafted LeBron (41) and Durant (38), then two 19-year-olds. Half the roster gets the senior discount, the other half can\'t rent a car. Named the team after Tyler Herro and did not draft Tyler Herro.',
    Amy: 'Kept Luka, then opened a retirement home: Kawhi 35, McCollum 35, DeRozan 37, Butler 37, Powell 33, White 32. One center on the whole roster, picked after 4 minutes 17 seconds of thought. Got clocked twice.',
    Kyle: 'Sat out the draft. The app made all 12 picks in 3 seconds total, took three point guards with its first four, and grabbed Mark Williams for 24 projected games. The robot did fine.',
    Joel: 'Had the first pick and took Jokic. No notes. Then built a waiting room: Embiid, Paul George at 36, and LaVine. Named the team after Kyle, who let the app draft.',
    Bryan: 'Doubled down on Portland guards: Lillard at 4.37 after a lost season, then Ja Morant at 6.57. Six centers and one small forward. Team Clown Baby, as advertised.',
    Brey: 'The youngest roster in the league, nobody over 29. Called the clock four times, the league\'s hall monitor. Took Sandro Mamukelashvili with the last pick so "Mamu, There Goes That Amen" would have both its players.',
    Aaron: 'Named the team The Hardened Knueppels and watched Patrick draft Kon Knueppel at 6.58. Took Kyrie at 5.47. Spent the second-most time on the clock and drafted Day\'Ron Sharpe with some of it.',
    Dustin: 'Kept two fifth-rounders, Kessler and Chet. Six centers, one point guard. Closed with Porzingis, which is a fine number of games for a center to play in a month.',
    Derek: 'Kept Wembanyama, the best keeper in the room. Then opened a Utah Jazz fan club: Jaren Jackson Jr., Keyonte George and Darryn Peterson. Brey called the clock and Derek took JJJ anyway, after 3 minutes 16 seconds.',
    Patrick: 'Took Cade at 3 with Luka and Wemby off the board, fine. Then Curry, 38, in round two, and Myles Turner in round eight. Drafted Kon Knueppel mostly, we think, to upset Aaron.',
  },
};
