<?php
/**
 * Telegram ticket sale alert records.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * One row per paid transaction that could produce a ticket sale alert
 * (#2448).
 *
 * The unique transaction key is the deduplication record: a replayed
 * webhook or confirmation finds the row and adds none, and only the worker
 * whose update moves a row out of `queued` may build and send its alert.
 * Rows are never deleted by history retention, so a sale is never alerted
 * twice however late it is replayed.
 *
 * A row moves `queued` → `claimed` (being prepared) → `sending` (the
 * Telegram request is about to go out) → `sent`, `failed`, `uncertain` or
 * `skipped`. A worker interrupted while `claimed` sent nothing and its row
 * is queued again; one interrupted while `sending` may have been accepted
 * by Telegram, so its row becomes `uncertain` and is never resent
 * automatically.
 *
 * A sale of an organizer with a daily or weekly digest (#2449) moves from
 * `claimed` to `pending` instead of being sent. A digest run claims all of
 * its organizer's pending rows at once under a new batch ID, so two runs
 * never put one sale in two digests, and the batch then moves through
 * `sending` like a single alert. A digest Telegram refused returns its rows
 * to `pending` for the next digest.
 *
 * Rows hold IDs, a state and a safe reason code only: never the
 * destination, the bot token, buyer data or Telegram's own error text.
 */
class SaleAlertLog {
	public const TABLE_SUFFIX      = 'fair_events_sale_alerts';
	public const DB_VERSION        = '2';
	public const DB_VERSION_OPTION = 'fair_events_sale_alerts_db_version';

	public const QUEUED    = 'queued';
	public const PENDING   = 'pending';
	public const CLAIMED   = 'claimed';
	public const SENDING   = 'sending';
	public const SENT      = 'sent';
	public const FAILED    = 'failed';
	public const UNCERTAIN = 'uncertain';
	public const SKIPPED   = 'skipped';

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
	 * Whether the table is at the current version.
	 *
	 * @return bool
	 */
	public static function is_current() {
		return self::DB_VERSION === (string) get_option( self::DB_VERSION_OPTION, '' );
	}

	/**
	 * Create the table when its version changed.
	 *
	 * @return bool Whether the table is at the current version.
	 */
	public static function maybe_install() {
		if ( self::is_current() ) {
			return true;
		}
		if ( ! Lock::acquire( Lock::MIGRATION ) ) {
			return false;
		}

		try {
			global $wpdb;
			require_once ABSPATH . 'wp-admin/includes/upgrade.php';
			$table   = self::table_name();
			$charset = $wpdb->get_charset_collate();
			dbDelta(
				"CREATE TABLE {$table} (
					id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
					transaction_id bigint(20) unsigned NOT NULL,
					event_id bigint(20) unsigned NOT NULL DEFAULT 0,
					organizer_id varchar(36) NOT NULL DEFAULT '',
					state varchar(20) NOT NULL,
					reason varchar(40) NOT NULL DEFAULT '',
					batch varchar(36) NOT NULL DEFAULT '',
					created_at datetime NOT NULL,
					updated_at datetime NOT NULL,
					PRIMARY KEY  (id),
					UNIQUE KEY transaction_id (transaction_id),
					KEY state_updated (state,updated_at),
					KEY organizer_state (organizer_id,state),
					KEY batch (batch),
					KEY recent (created_at)
				) {$charset};"
			);

			if ( $table !== $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) ) {
				return false;
			}
			update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
			return true;
		} finally {
			Lock::release( Lock::MIGRATION );
		}
	}

	/**
	 * Record a paid transaction's alert as queued, unless it has a row.
	 *
	 * @param int    $transaction_id Connector transaction ID.
	 * @param int    $event_id       Owning event when queued.
	 * @param string $organizer_id   Organizer it was routed to when queued; '' when unresolved.
	 * @return bool Whether this call added the row.
	 */
	public function queue( $transaction_id, $event_id, $organizer_id ) {
		if ( ! self::is_current() ) {
			return false;
		}
		$now = current_time( 'mysql', true );
		return 0 < HistoryTables::insert_ignore(
			self::table_name(),
			array(
				'transaction_id' => (int) $transaction_id,
				'event_id'       => (int) $event_id,
				'organizer_id'   => (string) $organizer_id,
				'state'          => self::QUEUED,
				'reason'         => '',
				'created_at'     => $now,
				'updated_at'     => $now,
			)
		);
	}

	/**
	 * One transaction's row.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array|null
	 */
	public function get( $transaction_id ) {
		if ( ! self::is_current() ) {
			return null;
		}
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE transaction_id = %d', self::table_name(), (int) $transaction_id ), ARRAY_A );
		return is_array( $row ) ? self::hydrate( $row ) : null;
	}

	/**
	 * Move a row from one state to another, atomically: of several
	 * workers, only one sees its update succeed.
	 *
	 * @param int    $transaction_id Connector transaction ID.
	 * @param string $from           Expected current state.
	 * @param string $to             New state.
	 * @param string $reason         Safe reason code.
	 * @return bool Whether this call moved the row.
	 */
	public function transition( $transaction_id, $from, $to, $reason = '' ) {
		if ( ! self::is_current() ) {
			return false;
		}
		global $wpdb;
		$updated = $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET state = %s, reason = %s, updated_at = %s WHERE transaction_id = %d AND state = %s',
				self::table_name(),
				$to,
				substr( (string) $reason, 0, 40 ),
				current_time( 'mysql', true ),
				(int) $transaction_id,
				$from
			)
		);
		return 1 === $updated;
	}

	/**
	 * Transactions whose rows are in a state, oldest change first.
	 *
	 * @param string   $state  State.
	 * @param int|null $before Only rows last changed before this Unix time.
	 * @param int      $limit  Maximum rows.
	 * @return int[]
	 */
	public function in_state( $state, $before = null, $limit = 50 ) {
		if ( ! self::is_current() ) {
			return array();
		}
		global $wpdb;
		$cutoff = gmdate( 'Y-m-d H:i:s', null === $before ? time() + DAY_IN_SECONDS : (int) $before );
		return array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					'SELECT transaction_id FROM %i WHERE state = %s AND updated_at < %s ORDER BY updated_at ASC LIMIT %d',
					self::table_name(),
					$state,
					$cutoff,
					(int) $limit
				)
			)
		);
	}

	/**
	 * Claim an organizer's pending rows for one digest, atomically: a row
	 * claimed by one run is never claimed by another.
	 *
	 * @param string $organizer_id Organizer key.
	 * @param string $batch        New batch ID.
	 * @param int    $limit        Maximum rows.
	 * @return int[] Transactions claimed, oldest sale first.
	 */
	public function claim_pending( $organizer_id, $batch, $limit = 500 ) {
		if ( ! self::is_current() || '' === (string) $organizer_id || '' === (string) $batch ) {
			return array();
		}
		global $wpdb;
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET state = %s, batch = %s, updated_at = %s WHERE organizer_id = %s AND state = %s ORDER BY created_at ASC, id ASC LIMIT %d',
				self::table_name(),
				self::CLAIMED,
				(string) $batch,
				current_time( 'mysql', true ),
				(string) $organizer_id,
				self::PENDING,
				(int) $limit
			)
		);
		return array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					'SELECT transaction_id FROM %i WHERE batch = %s AND state = %s ORDER BY created_at ASC, id ASC',
					self::table_name(),
					(string) $batch,
					self::CLAIMED
				)
			)
		);
	}

	/**
	 * Pending rows by organizer.
	 *
	 * @return array<string, int> Count of pending sales by organizer key.
	 */
	public function pending_counts() {
		if ( ! self::is_current() ) {
			return array();
		}
		global $wpdb;
		$counts = array();
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT organizer_id, COUNT(*) AS total FROM %i WHERE state = %s GROUP BY organizer_id', self::table_name(), self::PENDING ),
			ARRAY_A
		) as $row ) {
			$counts[ (string) $row['organizer_id'] ] = (int) $row['total'];
		}
		return $counts;
	}

	/**
	 * The most recent rows, newest first.
	 *
	 * @param int $limit Maximum rows.
	 * @return array[]
	 */
	public function recent( $limit = 20 ) {
		if ( ! self::is_current() ) {
			return array();
		}
		global $wpdb;
		$rows = (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM %i ORDER BY created_at DESC, id DESC LIMIT %d', self::table_name(), (int) $limit ),
			ARRAY_A
		);
		return array_map( array( self::class, 'hydrate' ), $rows );
	}

	/**
	 * Typed row.
	 *
	 * @param array $row Database row.
	 * @return array
	 */
	private static function hydrate( array $row ) {
		return array(
			'id'             => (int) $row['id'],
			'transaction_id' => (int) $row['transaction_id'],
			'event_id'       => (int) $row['event_id'],
			'organizer_id'   => (string) $row['organizer_id'],
			'state'          => (string) $row['state'],
			'reason'         => (string) $row['reason'],
			'batch'          => (string) ( $row['batch'] ?? '' ),
			'created_at'     => (string) $row['created_at'],
			'updated_at'     => (string) $row['updated_at'],
		);
	}
}
