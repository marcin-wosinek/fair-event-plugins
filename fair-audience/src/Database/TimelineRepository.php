<?php
/**
 * Timeline Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

defined( 'WPINC' ) || die;

/**
 * Repository for aggregating timeline events from multiple tables.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TimelineRepository {

	/**
	 * Get recent event signups.
	 *
	 * @param int $limit Maximum number of rows.
	 * @return array Raw rows.
	 */
	public function get_recent_signups( $limit ) {
		global $wpdb;

		$ep_table = $wpdb->prefix . 'fair_audience_event_participants';
		$p_table  = $wpdb->prefix . 'fair_audience_participants';

		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT ep.id, ep.event_id, ep.event_date_id, ep.label, ep.created_at,
					p.name AS participant_name, p.surname AS participant_surname
				FROM %i ep
				LEFT JOIN %i p ON ep.participant_id = p.id
				ORDER BY ep.created_at DESC
				LIMIT %d',
				$ep_table,
				$p_table,
				$limit
			),
			ARRAY_A
		);
	}

	/**
	 * Get recent questionnaire submissions.
	 *
	 * @param int $limit Maximum number of rows.
	 * @return array Raw rows.
	 */
	public function get_recent_submissions( $limit ) {
		global $wpdb;

		$qs_table = $wpdb->prefix . 'fair_audience_questionnaire_submissions';
		$p_table  = $wpdb->prefix . 'fair_audience_participants';

		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT qs.id, qs.title, qs.event_date_id, qs.created_at,
					p.name AS participant_name, p.surname AS participant_surname
				FROM %i qs
				LEFT JOIN %i p ON qs.participant_id = p.id
				ORDER BY qs.created_at DESC
				LIMIT %d',
				$qs_table,
				$p_table,
				$limit
			),
			ARRAY_A
		);
	}

	/**
	 * Get recent fees with payment summaries.
	 *
	 * Returns one row per fee with aggregated payment stats.
	 *
	 * @param int $limit Maximum number of rows.
	 * @return array Raw rows with fee info and payment aggregates.
	 */
	public function get_recent_fees( $limit ) {
		global $wpdb;

		$f_table  = $wpdb->prefix . 'fair_audience_fees';
		$fp_table = $wpdb->prefix . 'fair_audience_fee_payments';

		// Get recent fees.
		$fees = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, name, amount, currency, status, created_at
				FROM %i
				ORDER BY created_at DESC
				LIMIT %d',
				$f_table,
				$limit
			),
			ARRAY_A
		);

		// For each fee, get payment summary.
		foreach ( $fees as &$fee ) {
			$fee['total_amount'] = (float) $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COALESCE(SUM(amount), 0) FROM %i WHERE fee_id = %d',
					$fp_table,
					$fee['id']
				)
			);

			$fee['total_paid'] = (float) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COALESCE(SUM(amount), 0) FROM %i WHERE fee_id = %d AND status = 'paid'",
					$fp_table,
					$fee['id']
				)
			);

			// Get pending payments grouped by amount.
			$fee['pending_groups'] = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT amount, COUNT(*) AS count FROM %i WHERE fee_id = %d AND status = 'pending' GROUP BY amount ORDER BY count DESC",
					$fp_table,
					$fee['id']
				),
				ARRAY_A
			);
		}

		return $fees;
	}

	/**
	 * Get recent custom mail messages.
	 *
	 * @param int $limit Maximum number of rows.
	 * @return array Raw rows.
	 */
	public function get_recent_emails( $limit ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_audience_custom_mail_messages';

		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, subject, sent_count, failed_count, skipped_count, created_at
				FROM %i
				ORDER BY created_at DESC
				LIMIT %d',
				$table,
				$limit
			),
			ARRAY_A
		);
	}

	/**
	 * Get recent Instagram posts.
	 *
	 * @param int $limit Maximum number of rows.
	 * @return array Raw rows.
	 */
	public function get_recent_instagram_posts( $limit ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_audience_instagram_posts';

		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, caption, status, permalink, published_at, created_at
				FROM %i
				ORDER BY created_at DESC
				LIMIT %d',
				$table,
				$limit
			),
			ARRAY_A
		);
	}

	/**
	 * Get recent polls.
	 *
	 * @param int $limit Maximum number of rows.
	 * @return array Raw rows.
	 */
	public function get_recent_polls( $limit ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_audience_polls';

		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, title, status, created_at
				FROM %i
				ORDER BY created_at DESC
				LIMIT %d',
				$table,
				$limit
			),
			ARRAY_A
		);
	}

	/**
	 * Get recent new participants.
	 *
	 * @param int $limit Maximum number of rows.
	 * @return array Raw rows.
	 */
	public function get_recent_participants( $limit ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_audience_participants';

		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, name, surname, email, created_at
				FROM %i
				ORDER BY created_at DESC
				LIMIT %d',
				$table,
				$limit
			),
			ARRAY_A
		);
	}

	/**
	 * Get total counts for all timeline sources.
	 *
	 * @param bool $include_payments Whether to include fee payments.
	 * @return int Total count across all sources.
	 */
	public function get_total_count( $include_payments ) {
		global $wpdb;

		$count = 0;

		$tables = array(
			$wpdb->prefix . 'fair_audience_event_participants',
			$wpdb->prefix . 'fair_audience_questionnaire_submissions',
			$wpdb->prefix . 'fair_audience_custom_mail_messages',
			$wpdb->prefix . 'fair_audience_instagram_posts',
			$wpdb->prefix . 'fair_audience_polls',
			$wpdb->prefix . 'fair_audience_participants',
		);

		if ( $include_payments ) {
			$tables[] = $wpdb->prefix . 'fair_audience_fees';
		}

		foreach ( $tables as $table ) {
			$result = $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COUNT(*) FROM %i',
					$table
				)
			);
			$count += (int) $result;
		}

		return $count;
	}
}
