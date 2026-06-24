<?php
/**
 * Database Schema
 *
 * @package FairForm
 */

namespace FairForm\Database;

defined( 'WPINC' ) || die;

/**
 * Database schema definitions for Fair Form tables.
 *
 * Table names deliberately keep the `fair_audience_questionnaire_*` prefix so
 * existing installs need no data migration. `dbDelta` is idempotent — these
 * calls are safe to run against tables already created by fair-audience.
 */
class Schema {

	/**
	 * Get SQL for creating the questionnaire submissions table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_questionnaire_submissions_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_audience_questionnaire_submissions';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			participant_id BIGINT UNSIGNED NULL,
			event_date_id BIGINT UNSIGNED DEFAULT NULL,
			post_id BIGINT UNSIGNED DEFAULT NULL,
			title VARCHAR(255) DEFAULT '',
			form_id VARCHAR(64) DEFAULT NULL,
			form_title VARCHAR(255) DEFAULT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			KEY idx_participant_id (participant_id),
			KEY idx_event_date_id (event_date_id),
			KEY idx_post_id (post_id),
			KEY idx_form_id (form_id)
		) ENGINE=InnoDB $charset_collate;";
	}

	/**
	 * Get SQL for creating the questionnaire answers table.
	 *
	 * @return string SQL statement.
	 */
	public static function get_questionnaire_answers_table_sql() {
		global $wpdb;

		$table_name      = $wpdb->prefix . 'fair_audience_questionnaire_answers';
		$charset_collate = $wpdb->get_charset_collate();

		return "CREATE TABLE $table_name (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			submission_id BIGINT UNSIGNED NOT NULL,
			question_key VARCHAR(100) DEFAULT '',
			question_text VARCHAR(500) NOT NULL,
			question_type ENUM('radio','checkbox','short_text','long_text','select','number','date','multiselect','file_upload','email') NOT NULL DEFAULT 'short_text',
			answer_value TEXT NOT NULL,
			display_order INT DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			KEY idx_submission_id (submission_id),
			KEY idx_question_key (question_key)
		) ENGINE=InnoDB $charset_collate;";
	}
}
