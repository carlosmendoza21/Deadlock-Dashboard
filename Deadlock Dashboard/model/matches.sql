SELECT match_id,
  any(winning_team) = 'Team0' AS t0win,
  any(duration_s) AS dur,
  any(match_mode) AS mm,
  any(average_badge_team0) AS b0,
  any(average_badge_team1) AS b1,
  count() AS np,
  groupArrayIf(hero_id, team = 'Team0') AS h0,
  groupArrayIf(hero_id, team = 'Team1') AS h1,
  sumForEachIf(arrayMap(t -> arrayElement(`stats.net_worth`, indexOf(`stats.time_stamp_s`, t)), [360,720,900,1200,1500,1800,2100,2400,2700,3000]), team = 'Team0') AS nw0,
  sumForEachIf(arrayMap(t -> arrayElement(`stats.net_worth`, indexOf(`stats.time_stamp_s`, t)), [360,720,900,1200,1500,1800,2100,2400,2700,3000]), team = 'Team1') AS nw1,
  any(`objectives.destroyed_time_s`) AS od,
  any(`objectives.team_objective`) AS oo,
  any(`objectives.team`) AS ot
FROM match_player
WHERE match_mode IN ('Ranked','Unranked') AND game_mode = 'Normal' AND match_outcome = 'TeamWin'
  AND start_time > now() - INTERVAL 14 DAY AND duration_s > 600
GROUP BY match_id
HAVING np = 12
LIMIT 25000
