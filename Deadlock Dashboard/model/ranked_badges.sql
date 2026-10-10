SELECT match_id,
  groupArrayIf(prev, player_team = 'Team0' AND prev > 0) AS r0,
  groupArrayIf(prev, player_team = 'Team1' AND prev > 0) AS r1
FROM (
  SELECT match_id, player_team, start_time,
    lagInFrame(coalesce(ranked_display_badge, 0), 1, 0) OVER (PARTITION BY account_id ORDER BY start_time ASC ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS prev
  FROM player_match_history
  WHERE match_mode = 'Ranked' AND game_mode = 'Normal' AND start_time > now() - INTERVAL 35 DAY
)
WHERE start_time > now() - INTERVAL 15 DAY
GROUP BY match_id
