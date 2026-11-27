<?php
/**
 * Scheduled sharing-reminder runs.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WhatsApp;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag,WordPress.DB.DirectDatabaseQuery

/**
 * One row per feed and scheduled week, claimed before anything is checked
 * or sent.
 *
 * The (feed, week) pair is unique, so a second cron run for the same week,
 * a replay, or a run after the collaborator was replaced finds the row and
 * stops: whatever happened to the first run (sent, refused, uncertain, or
 * interrupted after the claim), it is never sent again automatically. The
 * row then records what the run did: a skip or failure with its reason, or
 * the delivery it started, whose WhatsApp outcome lives in
 * {@see Deliveries}.
 *
 * Only the masked recipient and the template are kept.
 */
class ReminderRuns {
	public const DB_VERSION        = '1';
	public const DB_VERSION_OPTION = 'fair_events_experimental_whatsapp_reminder_runs_db_version';
	public const TABLE_SUFFIX      = 'fair_events_whatsapp_reminder_runs';

	/** Days a run is kept. */
	public const RETENTION_DAYS = 90;

	/** Run states. */
	public const CLAIMED      = 'claimed';
	public const SKIPPED      = 'skipped';
	public const FAILED       = 'failed';
	public const SENDING      = 'sending';
	public const ACCEPTED     = 'accepted';
	public const NOT_ACCEPTED = 'not_accepted';
	public const UNCERTAIN    = 'uncertain';

	public const STATES = array( self::CLAIMED, self::SKIPPED, self::FAILED, self::SENDING, self::ACCEPTED, self::NOT_ACCEPTED, self::UNCERTAIN );

	/** @return string */
	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . self::TABLE_SUFFIX;
	}

	/** Install or upgrade the table when the stored version differs. */
	public static function maybe_install() {
		if ( self::DB_VERSION !== (string) get_option( self::DB_VERSION_OPTION, '' ) ) {
			self::install();
		}
	}

	/** Install or upgrade the table. */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table   = self::table_name();
		$charset = $wpdb->get_charset_collate();
		dbDelta(
			"CREATE TABLE {$table} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				source_id bigint(20) unsigned NOT NULL,
				send_week varchar(10) NOT NULL,
				state varchar(16) NOT NULL,
				reason varchar(40) NOT NULL DEFAULT '',
				delivery_id bigint(20) unsigned DEFAULT NULL,
				recipient varchar(32) NOT NULL DEFAULT '',
				template_name varchar(191) NOT NULL DEFAULT '',
				template_language varchar(16) NOT NULL DEFAULT '',
				created_at datetime NOT NULL,
				updated_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY occurrence (source_id,send_week),
				KEY retention (created_at)
			) {$charset};"
		);
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * Claim a feed's scheduled week. Only one caller ever gets it.
	 *
	 * @param int    $source_id Event feed ID.
	 * @param string $send_week ISO week, e.g. '2026-W48'.
	 * @return int Run ID, or 0 when the week was already claimed or the
	 *     claim could not be stored.
	 */
	public function claim( $source_id, $send_week ) {
		global $wpdb;
		$now     = current_time( 'mysql', true );
		$changed = $wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO %i (source_id, send_week, state, created_at, updated_at) VALUES (%d, %s, %s, %s, %s)',
				self::table_name(),
				absint( $source_id ),
				(string) $send_week,
				self::CLAIMED,
				$now,
				$now
			)
		);
		if ( 1 !== $changed ) {
			return 0;
		}
		$this->prune();
		return (int) $wpdb->insert_id;
	}

	/**
	 * Record what a claimed run did.
	 *
	 * @param int   $id     Run ID.
	 * @param array $fields Any of `state`, `reason`, `delivery_id`,
	 *                      `recipient`, `template_name`, `template_language`.
	 * @return bool Whether it was stored.
	 */
	public function update( $id, array $fields ) {
		global $wpdb;
		$row     = array( 'updated_at' => current_time( 'mysql', true ) );
		$formats = array( '%s' );
		if ( isset( $fields['state'] ) && in_array( $fields['state'], self::STATES, true ) ) {
			$row['state'] = $fields['state'];
			$formats[]    = '%s';
		}
		if ( isset( $fields['reason'] ) ) {
			$row['reason'] = substr( sanitize_key( (string) $fields['reason'] ), 0, 40 );
			$formats[]     = '%s';
		}
		if ( isset( $fields['delivery_id'] ) ) {
			$row['delivery_id'] = absint( $fields['delivery_id'] );
			$formats[]          = '%d';
		}
		if ( isset( $fields['recipient'] ) ) {
			$row['recipient'] = mb_substr( (string) $fields['recipient'], 0, 32 );
			$formats[]        = '%s';
		}
		if ( isset( $fields['template_name'] ) && Client::valid_template_name( $fields['template_name'] ) ) {
			$row['template_name'] = $fields['template_name'];
			$formats[]            = '%s';
		}
		if ( isset( $fields['template_language'] ) && Client::valid_language( $fields['template_language'] ) ) {
			$row['template_language'] = $fields['template_language'];
			$formats[]                = '%s';
		}
		return false !== $wpdb->update( self::table_name(), $row, array( 'id' => (int) $id ), $formats, array( '%d' ) );
	}

	/**
	 * One run.
	 *
	 * @param int $id Run ID.
	 * @return array|null Raw row.
	 */
	public function get( $id ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', self::table_name(), (int) $id ), ARRAY_A );
		return $row ? $row : null;
	}

	/**
	 * The newest runs, each with its delivery row when it started one.
	 *
	 * @param int $limit Most rows.
	 * @return array[] Raw run rows, newest first, with `delivery` (row or null).
	 */
	public function recent( $limit = 20 ) {
		global $wpdb;
		$rows       = $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM %i ORDER BY id DESC LIMIT %d', self::table_name(), max( 1, (int) $limit ) ),
			ARRAY_A
		);
		$rows       = $rows ? $rows : array();
		$deliveries = new Deliveries();
		foreach ( $rows as &$row ) {
			$row['delivery'] = $row['delivery_id'] ? $deliveries->get( (int) $row['delivery_id'] ) : null;
		}
		unset( $row );
		return $rows;
	}

	/** Delete runs past {@see RETENTION_DAYS}. */
	public function prune() {
		global $wpdb;
		$wpdb->query(
			$wpdb->prepare(
				'DELETE FROM %i WHERE created_at < %s',
				self::table_name(),
				gmdate( 'Y-m-d H:i:s', time() - self::RETENTION_DAYS * DAY_IN_SECONDS )
			)
		);
	}
}
