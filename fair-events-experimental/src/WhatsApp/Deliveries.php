<?php
/**
 * WhatsApp sends and their delivery updates.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WhatsApp;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag,WordPress.DB.DirectDatabaseQuery

/**
 * One row per template send, updated by Meta's verified status callbacks.
 *
 * API acceptance (`send_outcome`) and delivery evidence are stored apart:
 * `status_rank` only ever rises (sent → delivered → read) and the first
 * failure is kept in `failed_at`/`failure_code` beside it, so duplicate or
 * out-of-order callbacks never move a row backwards and confirmed delivery
 * outranks a failure without erasing it. Every update is a single
 * conditional UPDATE, so concurrent callbacks cannot interleave.
 *
 * A callback that arrives before the send response is stored waits in a
 * bounded unmatched table and is applied once the message ID is attached.
 *
 * Only the masked recipient, the template and allowlisted codes are kept:
 * no payloads, message bodies, full numbers or secrets. Test sends use
 * origin `admin_test`; scheduled sends (not built yet) will use `scheduled`.
 */
class Deliveries {
	public const DB_VERSION        = '1';
	public const DB_VERSION_OPTION = 'fair_events_experimental_whatsapp_db_version';
	public const TABLE_SUFFIX      = 'fair_events_whatsapp_deliveries';
	public const UNMATCHED_SUFFIX  = 'fair_events_whatsapp_unmatched';
	public const CLEANUP_HOOK      = 'fair_events_experimental_whatsapp_cleanup';

	/** Days a delivery record is kept. */
	public const RETENTION_DAYS = 30;

	/** Hours an unmatched callback waits for its send. */
	public const UNMATCHED_HOURS = 24;

	/** Most unmatched callbacks kept. */
	public const MAX_UNMATCHED = 500;

	/** Allowed `origin` values. */
	public const ORIGINS = array( 'admin_test', 'scheduled' );

	/** Send results before any callback. */
	public const SEND_OUTCOMES = array( 'accepted', 'not_accepted', 'uncertain' );

	/** Callback statuses that prove progress, by rank. */
	public const RANKS = array(
		'sent'      => 1,
		'delivered' => 2,
		'read'      => 3,
	);

	/**
	 * Delivery failure codes worth keeping; anything else is stored as 0.
	 * See https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes.
	 */
	public const FAILURE_CODES = array( 1, 2, 4, 368, 130429, 130472, 131000, 131016, 131021, 131026, 131031, 131042, 131045, 131047, 131048, 131049, 131050, 131051, 131052, 131053, 131056, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 133010 );

	/** @return string */
	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . self::TABLE_SUFFIX;
	}

	/** @return string */
	public static function unmatched_table_name() {
		global $wpdb;
		return $wpdb->prefix . self::UNMATCHED_SUFFIX;
	}

	/** Install or upgrade the tables when the stored version differs. */
	public static function maybe_install() {
		if ( self::DB_VERSION !== (string) get_option( self::DB_VERSION_OPTION, '' ) ) {
			self::install();
		}
	}

	/** Install or upgrade both tables. */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table     = self::table_name();
		$unmatched = self::unmatched_table_name();
		$charset   = $wpdb->get_charset_collate();
		dbDelta(
			"CREATE TABLE {$table} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				origin varchar(20) NOT NULL,
				waba_id varchar(32) NOT NULL DEFAULT '',
				phone_number_id varchar(32) NOT NULL DEFAULT '',
				message_id varchar(191) DEFAULT NULL,
				template_name varchar(191) NOT NULL DEFAULT '',
				template_language varchar(16) NOT NULL DEFAULT '',
				recipient varchar(32) NOT NULL DEFAULT '',
				send_outcome varchar(16) NOT NULL DEFAULT '',
				send_error varchar(40) NOT NULL DEFAULT '',
				meta_code int(10) unsigned DEFAULT NULL,
				status_rank tinyint(3) unsigned NOT NULL DEFAULT 0,
				status_at datetime DEFAULT NULL,
				failed_at datetime DEFAULT NULL,
				failure_code int(10) unsigned NOT NULL DEFAULT 0,
				created_at datetime NOT NULL,
				updated_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY message (message_id),
				KEY retention (created_at)
			) {$charset};
			CREATE TABLE {$unmatched} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				phone_number_id varchar(32) NOT NULL,
				message_id varchar(191) NOT NULL,
				status varchar(16) NOT NULL,
				status_at datetime NOT NULL,
				failure_code int(10) unsigned NOT NULL DEFAULT 0,
				received_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY message_status (message_id,status),
				KEY retention (received_at)
			) {$charset};"
		);
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * Record a send just before it goes out.
	 *
	 * @param array $context `origin`, `waba_id`, `phone_number_id`,
	 *                       `template_name`, `template_language` and the
	 *                       masked `recipient`.
	 * @return int Delivery ID, or 0 when it could not be recorded.
	 */
	public function start( array $context ) {
		global $wpdb;
		$now      = current_time( 'mysql', true );
		$inserted = $wpdb->insert(
			self::table_name(),
			array(
				'origin'            => in_array( $context['origin'] ?? '', self::ORIGINS, true ) ? $context['origin'] : 'admin_test',
				'waba_id'           => Configuration::valid_id( $context['waba_id'] ?? null ) ? $context['waba_id'] : '',
				'phone_number_id'   => Configuration::valid_id( $context['phone_number_id'] ?? null ) ? $context['phone_number_id'] : '',
				'template_name'     => Client::valid_template_name( $context['template_name'] ?? null ) ? $context['template_name'] : '',
				'template_language' => Client::valid_language( $context['template_language'] ?? null ) ? $context['template_language'] : '',
				'recipient'         => mb_substr( (string) ( $context['recipient'] ?? '' ), 0, 32 ),
				'created_at'        => $now,
				'updated_at'        => $now,
			),
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s' )
		);
		if ( ! $inserted ) {
			return 0;
		}
		$id = (int) $wpdb->insert_id;
		$this->prune();
		return $id;
	}

	/**
	 * Store the send's result and apply callbacks that arrived first.
	 *
	 * @param int   $id     Delivery ID from {@see start()}.
	 * @param array $result {@see Client::send_template()} result.
	 * @return bool Whether it was stored.
	 */
	public function finish( $id, array $result ) {
		global $wpdb;
		$outcome    = in_array( $result['outcome'] ?? '', self::SEND_OUTCOMES, true ) ? $result['outcome'] : 'uncertain';
		$message_id = 'accepted' === $outcome && Client::valid_message_id( $result['message_id'] ?? null ) ? $result['message_id'] : null;
		$updated    = $wpdb->update(
			self::table_name(),
			array(
				'send_outcome' => $outcome,
				'message_id'   => $message_id,
				'send_error'   => sanitize_key( (string) ( $result['code'] ?? '' ) ),
				'meta_code'    => isset( $result['meta_code'] ) && is_int( $result['meta_code'] ) && $result['meta_code'] > 0 ? $result['meta_code'] : null,
				'updated_at'   => current_time( 'mysql', true ),
			),
			array( 'id' => (int) $id ),
			array( '%s', '%s', '%s', '%d', '%s' ),
			array( '%d' )
		);
		if ( false === $updated ) {
			return false;
		}
		if ( null !== $message_id ) {
			return $this->reconcile( $message_id );
		}
		return true;
	}

	/**
	 * Apply one verified status callback.
	 *
	 * @param string   $phone_number_id Sender the callback is for.
	 * @param string   $message_id      Message ID.
	 * @param string   $status          sent, delivered, read or failed.
	 * @param int      $timestamp       Unix time Meta reported.
	 * @param int|null $failure_code    Meta's error code for a failure.
	 * @return bool False only when it could not be stored; Meta should retry.
	 */
	public function apply_status( $phone_number_id, $message_id, $status, $timestamp, $failure_code = null ) {
		global $wpdb;
		$status_at = gmdate( 'Y-m-d H:i:s', $timestamp > 0 ? (int) $timestamp : time() );
		$code      = self::failure_code( $failure_code );

		$applied = $this->apply_to_row( $phone_number_id, $message_id, $status, $status_at, $code );
		if ( false === $applied ) {
			return false;
		}
		if ( $applied > 0 || $this->exists( $phone_number_id, $message_id ) ) {
			// Applied, or a duplicate or older update the row already outranks.
			return true;
		}

		// Early callback: keep it until the send stores its message ID.
		$stored = $wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO %i (phone_number_id, message_id, status, status_at, failure_code, received_at) VALUES (%s, %s, %s, %s, %d, %s)',
				self::unmatched_table_name(),
				$phone_number_id,
				$message_id,
				$status,
				$status_at,
				$code,
				current_time( 'mysql', true )
			)
		);
		if ( false === $stored ) {
			return false;
		}
		// The send may have stored its ID in the meantime.
		if ( $this->exists( $phone_number_id, $message_id ) && ! $this->reconcile( $message_id ) ) {
			return false;
		}
		$this->prune_unmatched();
		return true;
	}

	/**
	 * The newest unexpired deliveries.
	 *
	 * @param int $limit Most rows.
	 * @return array[] Raw rows, newest first.
	 */
	public function recent( $limit = 20 ) {
		global $wpdb;
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE created_at >= %s ORDER BY id DESC LIMIT %d',
				self::table_name(),
				self::cutoff(),
				max( 1, (int) $limit )
			),
			ARRAY_A
		);
		return $rows ? $rows : array();
	}

	/**
	 * One delivery.
	 *
	 * @param int $id Delivery ID.
	 * @return array|null Raw row.
	 */
	public function get( $id ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', self::table_name(), (int) $id ), ARRAY_A );
		return $row ? $row : null;
	}

	/**
	 * Where a delivery stands: the send result when it was not accepted,
	 * else the strongest evidence. Delivered or read outranks a failure.
	 *
	 * @param array $row Delivery row.
	 * @return string accepted, sent, delivered, read, failed, not_accepted
	 *     or uncertain.
	 */
	public static function outcome( array $row ) {
		$send = (string) ( $row['send_outcome'] ?? '' );
		if ( 'accepted' !== $send ) {
			// '' is a send that never recorded its result.
			return 'not_accepted' === $send ? 'not_accepted' : 'uncertain';
		}
		$rank = (int) ( $row['status_rank'] ?? 0 );
		if ( $rank >= self::RANKS['read'] ) {
			return 'read';
		}
		if ( $rank >= self::RANKS['delivered'] ) {
			return 'delivered';
		}
		if ( ! empty( $row['failed_at'] ) ) {
			return 'failed';
		}
		return $rank >= self::RANKS['sent'] ? 'sent' : 'accepted';
	}

	/**
	 * An allowlisted failure code, or 0.
	 *
	 * @param mixed $code Meta's error code.
	 * @return int
	 */
	public static function failure_code( $code ) {
		return is_int( $code ) && in_array( $code, self::FAILURE_CODES, true ) ? $code : 0;
	}

	/** Delete deliveries past {@see RETENTION_DAYS} and stale or excess unmatched callbacks. */
	public function prune() {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE created_at < %s', self::table_name(), self::cutoff() ) );
		$this->prune_unmatched();
	}

	/** Delete unmatched callbacks past {@see UNMATCHED_HOURS} and beyond the newest {@see MAX_UNMATCHED}. */
	private function prune_unmatched() {
		global $wpdb;
		$table = self::unmatched_table_name();
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE received_at < %s', $table, gmdate( 'Y-m-d H:i:s', time() - self::UNMATCHED_HOURS * HOUR_IN_SECONDS ) ) );
		$oldest_kept = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i ORDER BY id DESC LIMIT 1 OFFSET %d', $table, self::MAX_UNMATCHED - 1 ) );
		if ( $oldest_kept ) {
			$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE id < %d', $table, (int) $oldest_kept ) );
		}
	}

	/**
	 * Apply waiting callbacks for a message, then drop them.
	 *
	 * @param string $message_id Message ID.
	 * @return bool
	 */
	private function reconcile( $message_id ) {
		global $wpdb;
		$table   = self::unmatched_table_name();
		$waiting = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i WHERE message_id = %s ORDER BY id', $table, $message_id ), ARRAY_A );
		foreach ( $waiting ? $waiting : array() as $row ) {
			if ( false === $this->apply_to_row( $row['phone_number_id'], $message_id, $row['status'], $row['status_at'], (int) $row['failure_code'] ) ) {
				return false;
			}
			$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE id = %d', $table, (int) $row['id'] ) );
		}
		return true;
	}

	/**
	 * One conditional update: a rank only rises, the first failure is kept.
	 *
	 * @return int|false Rows changed, or false on a database error.
	 */
	private function apply_to_row( $phone_number_id, $message_id, $status, $status_at, $code ) {
		global $wpdb;
		$now = current_time( 'mysql', true );
		if ( 'failed' === $status ) {
			return $wpdb->query(
				$wpdb->prepare(
					'UPDATE %i SET failed_at = %s, failure_code = %d, updated_at = %s WHERE phone_number_id = %s AND message_id = %s AND failed_at IS NULL',
					self::table_name(),
					$status_at,
					$code,
					$now,
					$phone_number_id,
					$message_id
				)
			);
		}
		$rank = self::RANKS[ $status ];
		return $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET status_rank = %d, status_at = %s, updated_at = %s WHERE phone_number_id = %s AND message_id = %s AND status_rank < %d',
				self::table_name(),
				$rank,
				$status_at,
				$now,
				$phone_number_id,
				$message_id,
				$rank
			)
		);
	}

	/** @return bool Whether a send with this message ID is stored. */
	private function exists( $phone_number_id, $message_id ) {
		global $wpdb;
		return (bool) $wpdb->get_var(
			$wpdb->prepare( 'SELECT id FROM %i WHERE phone_number_id = %s AND message_id = %s', self::table_name(), $phone_number_id, $message_id )
		);
	}

	/** @return string UTC time before which deliveries have expired. */
	private static function cutoff() {
		return gmdate( 'Y-m-d H:i:s', time() - self::RETENTION_DAYS * DAY_IN_SECONDS );
	}
}
