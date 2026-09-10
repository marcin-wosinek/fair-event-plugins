<?php
/**
 * Persistent Meta Conversions delivery outbox.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Meta;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag,WordPress.DB.DirectDatabaseQuery

/** Stores and claims conversion delivery work. */
class Outbox {
	public const TABLE_SUFFIX = 'fair_events_meta_outbox';

	/** @return string */
	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . self::TABLE_SUFFIX;
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
				transaction_id bigint(20) unsigned NOT NULL,
				event_name varchar(40) NOT NULL,
				event_id char(64) NOT NULL,
				event_time bigint(20) unsigned NOT NULL,
				source_url text NOT NULL,
				value decimal(12,2) NOT NULL,
				currency char(3) NOT NULL,
				order_id varchar(64) NOT NULL DEFAULT '',
				fbp varchar(180) DEFAULT NULL,
				fbc varchar(180) DEFAULT NULL,
				state varchar(32) NOT NULL DEFAULT 'pending',
				attempt_count smallint(5) unsigned NOT NULL DEFAULT 0,
				next_attempt_at datetime NOT NULL,
				result_category varchar(40) NOT NULL DEFAULT '',
				meta_error_code varchar(40) NOT NULL DEFAULT '',
				meta_error_type varchar(80) NOT NULL DEFAULT '',
				created_at datetime NOT NULL,
				updated_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY logical_conversion (transaction_id,event_name),
				KEY due (state,next_attempt_at),
				KEY retention (updated_at)
			) {$charset};"
		);
		update_option( 'fair_events_experimental_meta_db_version', '1' );
	}

	/** @param array $event Event data. @return bool */
	public function enqueue( $event ) {
		global $wpdb;
		$now    = current_time( 'mysql', true );
		$result = $wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO %i (transaction_id,event_name,event_id,event_time,source_url,value,currency,order_id,fbp,fbc,state,next_attempt_at,created_at,updated_at) VALUES (%d,%s,%s,%d,%s,%f,%s,%s,%s,%s,%s,%s,%s,%s)',
				self::table_name(),
				$event['transaction_id'],
				$event['event_name'],
				$event['event_id'],
				$event['event_time'],
				$event['source_url'],
				$event['value'],
				$event['currency'],
				$event['order_id'],
				$event['fbp'],
				$event['fbc'],
				'pending',
				$now,
				$now,
				$now
			)
		);
		return false !== $result && $result > 0;
	}

	/** Atomically claim the next due row. @return object|null */
	public function claim_due() {
		global $wpdb;
		$table = self::table_name();
		$id    = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM %i WHERE state IN ('pending','retry_pending') AND next_attempt_at <= %s ORDER BY next_attempt_at,id LIMIT 1", $table, current_time( 'mysql', true ) ) );
		if ( ! $id ) {
			return null;
		}
		$claimed = $wpdb->query( $wpdb->prepare( "UPDATE %i SET state = 'sending', updated_at = %s WHERE id = %d AND state IN ('pending','retry_pending')", $table, current_time( 'mysql', true ), $id ) );
		return 1 === $claimed ? $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', $table, $id ) ) : null;
	}

	/** @param int $id Row ID. @param string $category Safe result category. @param string $code Safe Meta code. @param string $type Safe Meta type. */
	public function finish( $id, $category, $code = '', $type = '' ) {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'UPDATE %i SET attempt_count = attempt_count + 1 WHERE id = %d', self::table_name(), $id ) );
		$wpdb->update(
			self::table_name(),
			array(
				'state'           => $category,
				'result_category' => $category,
				'meta_error_code' => sanitize_key( $code ),
				'meta_error_type' => sanitize_key( $type ),
				'fbp'             => null,
				'fbc'             => null,
				'updated_at'      => current_time( 'mysql', true ),
			),
			array( 'id' => $id ),
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%s' ),
			array( '%d' )
		);
	}

	/** @param object $row Claimed row. @param string $code Safe code. @param string $type Safe type. */
	public function retry( $row, $code = '', $type = '' ) {
		global $wpdb;
		$delays   = array( 60, 300, 1800, 7200, 43200 );
		$attempts = (int) $row->attempt_count + 1;
		if ( $attempts > count( $delays ) ) {
			$this->finish( (int) $row->id, 'retries_exhausted', $code, $type );
			return;
		}
		$next_attempt = gmdate( 'Y-m-d H:i:s', time() + $delays[ $attempts - 1 ] );
		$wpdb->update(
			self::table_name(),
			array(
				'state'           => 'retry_pending',
				'result_category' => 'temporary_error',
				'attempt_count'   => $attempts,
				'next_attempt_at' => $next_attempt,
				'meta_error_code' => sanitize_key( $code ),
				'meta_error_type' => sanitize_key( $type ),
				'updated_at'      => current_time( 'mysql', true ),
			),
			array( 'id' => $row->id ),
			array( '%s', '%s', '%d', '%s', '%s', '%s', '%s' ),
			array( '%d' )
		);
		if ( ! wp_next_scheduled( Conversions::DELIVERY_HOOK ) ) {
			wp_schedule_single_event( strtotime( $next_attempt . ' UTC' ), Conversions::DELIVERY_HOOK );
		}
	}

	/** @return array */
	public function diagnostics() {
		global $wpdb;
		$table  = self::table_name();
		$counts = $wpdb->get_results( $wpdb->prepare( 'SELECT state, COUNT(*) AS total FROM %i GROUP BY state', $table ), OBJECT_K );
		$recent = $wpdb->get_results( $wpdb->prepare( 'SELECT event_name,state,result_category,attempt_count,meta_error_code,meta_error_type,updated_at FROM %i ORDER BY updated_at DESC LIMIT 20', $table ), ARRAY_A );
		return array(
			'counts' => array_map( static fn( $row ) => (int) $row->total, $counts ? $counts : array() ),
			'recent' => $recent ? $recent : array(),
		);
	}

	/** Purge all rows older than the retention ceiling. */
	public function cleanup() {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE created_at < %s', self::table_name(), gmdate( 'Y-m-d H:i:s', time() - 90 * DAY_IN_SECONDS ) ) );
	}
}
