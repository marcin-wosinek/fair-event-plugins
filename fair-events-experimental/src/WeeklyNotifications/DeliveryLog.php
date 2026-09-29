<?php
/**
 * Weekly notification delivery record.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WeeklyNotifications;

defined( 'WPINC' ) || die;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * One row per scheduled week, provider, destination and message part.
 *
 * The unique key makes claiming a part atomic: only the run whose INSERT
 * creates the row may contact the provider for it, so retries and
 * overlapping cron runs never publish the same part twice. Rows hold a safe
 * error code and message only — never credentials or message text.
 */
class DeliveryLog {
	public const TABLE_SUFFIX       = 'fair_events_weekly_notification_deliveries';
	public const DB_VERSION         = '1';
	public const DB_VERSION_OPTION  = 'fair_events_experimental_weekly_notifications_db_version';
	private const RETENTION_DAYS    = 365;
	private const RECENT_ROW_LIMIT  = 30;
	private const MAX_MESSAGE_CHARS = 255;

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
	 * Create or upgrade the table when its version changed.
	 *
	 * @return void
	 */
	public static function maybe_install() {
		if ( self::DB_VERSION === (string) get_option( self::DB_VERSION_OPTION, '' ) ) {
			return;
		}

		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table   = self::table_name();
		$charset = $wpdb->get_charset_collate();
		dbDelta(
			"CREATE TABLE {$table} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				week_start date NOT NULL,
				provider varchar(20) NOT NULL,
				destination varchar(100) NOT NULL,
				part smallint(5) unsigned NOT NULL,
				part_count smallint(5) unsigned NOT NULL,
				state varchar(20) NOT NULL,
				error_code varchar(40) NOT NULL DEFAULT '',
				error_message varchar(255) NOT NULL DEFAULT '',
				created_at datetime NOT NULL,
				updated_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY delivery_part (week_start,provider,destination,part),
				KEY recent (updated_at)
			) {$charset};"
		);
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * Atomically claim a message part before contacting the provider.
	 *
	 * @param string $week_start  'Y-m-d' first day of the covered week.
	 * @param string $provider    Provider ID.
	 * @param string $destination Destination identifier.
	 * @param int    $part        1-based part number.
	 * @param int    $part_count  Number of parts.
	 * @param string $state       Initial state: 'sending', or 'skipped' to record a part never attempted.
	 * @param string $code        Safe error code for a skipped part.
	 * @return bool Whether this call created the record.
	 */
	public function claim( $week_start, $provider, $destination, $part, $part_count, $state = 'sending', $code = '' ) {
		global $wpdb;
		$now    = current_time( 'mysql', true );
		$result = $wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO %i (week_start,provider,destination,part,part_count,state,error_code,created_at,updated_at) VALUES (%s,%s,%s,%d,%d,%s,%s,%s,%s)',
				self::table_name(),
				$week_start,
				$provider,
				$destination,
				$part,
				$part_count,
				$state,
				$code,
				$now,
				$now
			)
		);
		return 1 === $result;
	}

	/**
	 * Record the outcome of a claimed part.
	 *
	 * @param string $week_start  'Y-m-d' first day of the covered week.
	 * @param string $provider    Provider ID.
	 * @param string $destination Destination identifier.
	 * @param int    $part        1-based part number.
	 * @param array  $result      Provider result: state, code, message.
	 * @return void
	 */
	public function finish( $week_start, $provider, $destination, $part, array $result ) {
		global $wpdb;
		$wpdb->update(
			self::table_name(),
			array(
				'state'         => $result['state'],
				'error_code'    => substr( sanitize_key( $result['code'] ), 0, 40 ),
				'error_message' => mb_substr( sanitize_text_field( $result['message'] ), 0, self::MAX_MESSAGE_CHARS ),
				'updated_at'    => current_time( 'mysql', true ),
			),
			array(
				'week_start'  => $week_start,
				'provider'    => $provider,
				'destination' => $destination,
				'part'        => $part,
			),
			array( '%s', '%s', '%s', '%s' ),
			array( '%s', '%s', '%s', '%d' )
		);
	}

	/**
	 * Most recent delivery records, newest first, with a site-local time.
	 *
	 * @return array[]
	 */
	public function recent() {
		global $wpdb;
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT week_start,provider,destination,part,part_count,state,error_code,error_message,updated_at FROM %i ORDER BY updated_at DESC, id DESC LIMIT %d',
				self::table_name(),
				self::RECENT_ROW_LIMIT
			),
			ARRAY_A
		);

		return array_map(
			static function ( $row ) {
				$row['part']             = (int) $row['part'];
				$row['part_count']       = (int) $row['part_count'];
				$row['updated_at_local'] = wp_date(
					get_option( 'date_format' ) . ' ' . get_option( 'time_format' ),
					strtotime( $row['updated_at'] . ' UTC' )
				);
				return $row;
			},
			$rows ? $rows : array()
		);
	}

	/**
	 * Delete records past the retention period.
	 *
	 * @return void
	 */
	public function cleanup() {
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
