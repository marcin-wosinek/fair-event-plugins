<?php
/**
 * Notification delivery history.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * One row per delivery attempt of an execution ({@see ExecutionHistory}):
 * one Telegram message part to one chat, or one email to one address.
 *
 * A row is written before the provider is contacted, with an unknown
 * outcome, and settled afterwards. A request that stops in between leaves
 * the outcome unknown; it is never inferred. Recipients and skips that were
 * never attempted are written settled.
 *
 * Rows hold the recipient's address or chat and, for group emails, the
 * participant's name as they were when sent, and a safe reason code. Never
 * credentials, unsubscribe links, message text or provider responses.
 */
class DeliveryHistory {
	public const TABLE_SUFFIX     = 'fair_events_notification_execution_deliveries';
	private const MAX_RECIPIENT   = 190;
	private const MAX_REASON_CODE = 40;

	/**
	 * Full table name.
	 *
	 * @return string
	 */
	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . self::TABLE_SUFFIX;
	}

	/**
	 * Table definition for dbDelta.
	 *
	 * @param string $charset Charset and collation clause.
	 * @return string
	 */
	public static function schema( $charset ) {
		$table = self::table_name();
		return "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			execution_id bigint(20) unsigned NOT NULL,
			source_key varchar(150) DEFAULT NULL,
			recipient varchar(190) NOT NULL DEFAULT '',
			recipient_name varchar(190) NOT NULL DEFAULT '',
			part smallint(5) unsigned NOT NULL DEFAULT 0,
			part_count smallint(5) unsigned NOT NULL DEFAULT 0,
			outcome varchar(20) NOT NULL,
			reason_code varchar(40) NOT NULL DEFAULT '',
			legacy tinyint(1) NOT NULL DEFAULT 0,
			attempted_at datetime DEFAULT NULL,
			finished_at datetime DEFAULT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY source_key (source_key),
			KEY execution (execution_id,id)
		) {$charset};";
	}

	/**
	 * Add a delivery row.
	 *
	 * @param int   $execution_id Execution ID.
	 * @param array $delivery     recipient, recipient_name, part, part_count,
	 *                            outcome, reason_code, attempted_at,
	 *                            finished_at; for imports also source_key and legacy.
	 * @return int Row ID, 0 when nothing was written (e.g. an import already done).
	 */
	public function insert( $execution_id, array $delivery ) {
		global $wpdb;
		$now     = current_time( 'mysql', true );
		$columns = array(
			'execution_id'   => (int) $execution_id,
			'source_key'     => $delivery['source_key'] ?? null,
			'recipient'      => mb_substr( (string) ( $delivery['recipient'] ?? '' ), 0, self::MAX_RECIPIENT ),
			'recipient_name' => mb_substr( sanitize_text_field( (string) ( $delivery['recipient_name'] ?? '' ) ), 0, self::MAX_RECIPIENT ),
			'part'           => (int) ( $delivery['part'] ?? 0 ),
			'part_count'     => (int) ( $delivery['part_count'] ?? 0 ),
			'outcome'        => (string) $delivery['outcome'],
			'reason_code'    => self::reason( $delivery['reason_code'] ?? '' ),
			'legacy'         => empty( $delivery['legacy'] ) ? 0 : 1,
			'attempted_at'   => $delivery['attempted_at'] ?? null,
			'finished_at'    => $delivery['finished_at'] ?? null,
			'created_at'     => $delivery['created_at'] ?? $now,
		);

		return HistoryTables::insert_ignore( self::table_name(), $columns );
	}

	/**
	 * Record a delivery's final outcome.
	 *
	 * @param int    $id      Row ID.
	 * @param string $outcome Delivery outcome.
	 * @param string $reason  Safe reason code.
	 * @return void
	 */
	public function settle( $id, $outcome, $reason ) {
		global $wpdb;
		$wpdb->update(
			self::table_name(),
			array(
				'outcome'     => $outcome,
				'reason_code' => self::reason( $reason ),
				'finished_at' => current_time( 'mysql', true ),
			),
			array( 'id' => (int) $id ),
			array( '%s', '%s', '%s' ),
			array( '%d' )
		);
	}

	/**
	 * Number of deliveries of an execution per outcome.
	 *
	 * @param int $execution_id Execution ID.
	 * @return array<string, int> Keyed by every delivery outcome.
	 */
	public function counts( $execution_id ) {
		global $wpdb;
		$counts = array_fill_keys( HistoryOutcome::DELIVERY_OUTCOMES, 0 );
		$rows   = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT outcome, COUNT(*) AS total FROM %i WHERE execution_id = %d GROUP BY outcome',
				self::table_name(),
				(int) $execution_id
			),
			ARRAY_A
		);
		foreach ( $rows ? $rows : array() as $row ) {
			if ( isset( $counts[ $row['outcome'] ] ) ) {
				$counts[ $row['outcome'] ] = (int) $row['total'];
			}
		}
		return $counts;
	}

	/**
	 * One page of an execution's deliveries, in the order they were recorded.
	 *
	 * @param int $execution_id Execution ID.
	 * @param int $page         1-based page.
	 * @param int $per_page     Page size.
	 * @return array{items: array[], total: int}
	 */
	public function for_execution( $execution_id, $page, $per_page ) {
		global $wpdb;
		$table = self::table_name();
		$total = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE execution_id = %d', $table, (int) $execution_id ) );
		$rows  = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id,recipient,recipient_name,part,part_count,outcome,reason_code,legacy,attempted_at,finished_at FROM %i WHERE execution_id = %d ORDER BY id ASC LIMIT %d OFFSET %d',
				$table,
				(int) $execution_id,
				(int) $per_page,
				( (int) $page - 1 ) * (int) $per_page
			),
			ARRAY_A
		);

		return array(
			'items' => $rows ? $rows : array(),
			'total' => $total,
		);
	}

	/**
	 * Mark deliveries still waiting for their outcome as interrupted.
	 *
	 * Their outcome stays unknown.
	 *
	 * @param int $execution_id Execution ID.
	 * @return void
	 */
	public function interrupt( $execution_id ) {
		global $wpdb;
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET reason_code = %s WHERE execution_id = %d AND finished_at IS NULL AND reason_code = %s',
				self::table_name(),
				'interrupted',
				(int) $execution_id,
				''
			)
		);
	}

	/**
	 * Delete the deliveries of executions that started before a moment.
	 *
	 * @param string $before UTC 'Y-m-d H:i:s'.
	 * @return void
	 */
	public function delete_before( $before ) {
		global $wpdb;
		$wpdb->query(
			$wpdb->prepare(
				'DELETE FROM %i WHERE execution_id IN (SELECT id FROM %i WHERE started_at < %s)',
				self::table_name(),
				ExecutionHistory::table_name(),
				$before
			)
		);
	}

	/**
	 * A safe reason code.
	 *
	 * @param string $reason Reason code.
	 * @return string
	 */
	private static function reason( $reason ) {
		return substr( sanitize_key( (string) $reason ), 0, self::MAX_REASON_CODE );
	}
}
