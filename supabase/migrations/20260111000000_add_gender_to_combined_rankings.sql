-- ========================================
-- Add gender to get_combined_rankings output
-- ========================================
-- Minimal change: adds a.gender to normalized_data and 'gender' to the json_build_object.
-- Rest of the function is unchanged from your existing definition.

CREATE OR REPLACE FUNCTION public.get_combined_rankings(p_game_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
BEGIN
  WITH video_stats AS (
    SELECT
      vg.application_id,
      AVG(vg.question_1_score + vg.question_2_score)::DOUBLE PRECISION as avg_score,
      COUNT(*)::INTEGER as grade_count
    FROM video_grades vg
    JOIN applications a ON a.id = vg.application_id
    WHERE vg.game_id = p_game_id
      AND a.resume_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM resumes r
        JOIN elo_ratings er ON er.resume_id = r.id
        WHERE r.id = a.resume_id
      )
    GROUP BY vg.application_id
  ),
  elo_min_max AS (
    SELECT
      MIN(er.rating)::DOUBLE PRECISION as min_elo,
      MAX(er.rating)::DOUBLE PRECISION as max_elo
    FROM applications a
    JOIN resumes r ON r.id = a.resume_id
    JOIN elo_ratings er ON er.resume_id = r.id
    JOIN video_stats vs ON vs.application_id = a.id
    WHERE a.game_id = p_game_id
  ),
  video_min_max AS (
    SELECT
      MIN(avg_score)::DOUBLE PRECISION as min_video,
      MAX(avg_score)::DOUBLE PRECISION as max_video
    FROM video_stats
  ),
  normalized_data AS (
    SELECT
      a.id as application_id,
      a.first_name,
      a.last_name,
      a.applicant_email,
      a.year,
      a.major,
      a.gender,
      a.video_youtube_url,
      a.resume_id,
      r.pdf_path as resume_pdf_path,
      er.rating as elo_rating,
      vs.avg_score as video_avg_score,
      vs.grade_count as video_grade_count,
      CASE
        WHEN emm.max_elo > emm.min_elo THEN
          ((er.rating - emm.min_elo) / (emm.max_elo - emm.min_elo)) * 100
        ELSE 50.0
      END as elo_normalized,
      CASE
        WHEN vmm.max_video > vmm.min_video THEN
          ((vs.avg_score - vmm.min_video) / (vmm.max_video - vmm.min_video)) * 100
        ELSE 50.0
      END as video_normalized
    FROM applications a
    JOIN resumes r ON r.id = a.resume_id
    JOIN elo_ratings er ON er.resume_id = r.id
    JOIN video_stats vs ON vs.application_id = a.id
    CROSS JOIN elo_min_max emm
    CROSS JOIN video_min_max vmm
    WHERE a.game_id = p_game_id
      AND a.resume_id IS NOT NULL
      AND er.rating IS NOT NULL
      AND vs.grade_count > 0
  ),
  final_rankings AS (
    SELECT
      *,
      (elo_normalized * 0.60 + video_normalized * 0.40) as combined_score
    FROM normalized_data
  )
  SELECT json_agg(
    json_build_object(
      'application_id', application_id,
      'first_name', first_name,
      'last_name', last_name,
      'applicant_email', applicant_email,
      'year', year,
      'major', major,
      'gender', gender,
      'video_youtube_url', video_youtube_url,
      'resume_id', resume_id,
      'resume_pdf_path', resume_pdf_path,
      'elo_rating', elo_rating,
      'video_avg_score', video_avg_score,
      'video_grade_count', video_grade_count,
      'elo_normalized', elo_normalized,
      'video_normalized', video_normalized,
      'combined_score', combined_score
    )
  )
  INTO v_result
  FROM (
    SELECT * FROM final_rankings
    ORDER BY combined_score DESC
  ) ordered_rankings;

  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;
