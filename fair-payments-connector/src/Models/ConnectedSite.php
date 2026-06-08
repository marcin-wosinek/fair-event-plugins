<?php
/**
 * Connected Site Model
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Models;

defined( 'WPINC' ) || die;

/**
 * Model for secondary sites this site pulls data from (data sharing consumer side).
 *
 * Records are stored in a single option as an array keyed by integer id. The
 * remote bearer token is stored as-is (plaintext), consistent with how the
 * plugin already stores Mollie access/refresh tokens; it is only ever exposed
 * through the admin-only REST controller, never in list responses.
 */
class ConnectedSite {
	/**
	 * Option name holding the array of connected site records.
	 *
	 * @var string
	 */
	const OPTION = 'fair_payment_connected_sites';

	/**
	 * Read the raw array of records from the option.
	 *
	 * @return array[] Array of associative records.
	 */
	private static function read() {
		$sites = get_option( self::OPTION, array() );

		return is_array( $sites ) ? array_values( $sites ) : array();
	}

	/**
	 * Persist the array of records to the option.
	 *
	 * @param array[] $sites Records to store.
	 * @return void
	 */
	private static function write( array $sites ) {
		update_option( self::OPTION, array_values( $sites ) );
	}

	/**
	 * Get all connected sites, newest first.
	 *
	 * @return array[] Records ordered by id descending.
	 */
	public static function get_all() {
		$sites = self::read();

		usort(
			$sites,
			static function ( $a, $b ) {
				return (int) $b['id'] - (int) $a['id'];
			}
		);

		return $sites;
	}

	/**
	 * Get a single connected site by id.
	 *
	 * @param int $id Site id.
	 * @return array|null Record or null when not found.
	 */
	public static function get_by_id( $id ) {
		foreach ( self::read() as $site ) {
			if ( (int) $site['id'] === (int) $id ) {
				return $site;
			}
		}

		return null;
	}

	/**
	 * Create a new connected site.
	 *
	 * @param array $data Input with label, base_url, token.
	 * @return array The created record.
	 */
	public static function create( array $data ) {
		$sites = self::read();

		$next_id = 1;
		foreach ( $sites as $site ) {
			$next_id = max( $next_id, (int) $site['id'] + 1 );
		}

		$record = array(
			'id'           => $next_id,
			'label'        => sanitize_text_field( $data['label'] ?? '' ),
			'base_url'     => esc_url_raw( $data['base_url'] ?? '' ),
			'token'        => trim( (string) ( $data['token'] ?? '' ) ),
			'scopes'       => array(),
			'status'       => 'unverified',
			'created_at'   => current_time( 'mysql', true ),
			'last_sync_at' => null,
		);

		$sites[] = $record;
		self::write( $sites );

		return $record;
	}

	/**
	 * Update an existing connected site.
	 *
	 * Only label, base_url and a non-empty token are merged; an empty token
	 * leaves the stored token untouched.
	 *
	 * @param int   $id   Site id.
	 * @param array $data Fields to update.
	 * @return array|null Updated record, or null when not found.
	 */
	public static function update( $id, array $data ) {
		$sites   = self::read();
		$updated = null;

		foreach ( $sites as $index => $site ) {
			if ( (int) $site['id'] !== (int) $id ) {
				continue;
			}

			if ( isset( $data['label'] ) ) {
				$site['label'] = sanitize_text_field( $data['label'] );
			}
			if ( isset( $data['base_url'] ) ) {
				$site['base_url'] = esc_url_raw( $data['base_url'] );
			}
			if ( ! empty( $data['token'] ) ) {
				$site['token'] = trim( (string) $data['token'] );
			}

			$sites[ $index ] = $site;
			$updated         = $site;
			break;
		}

		if ( null !== $updated ) {
			self::write( $sites );
		}

		return $updated;
	}

	/**
	 * Delete a connected site.
	 *
	 * @param int $id Site id.
	 * @return bool True when a record was removed.
	 */
	public static function delete( $id ) {
		$sites     = self::read();
		$remaining = array();
		$found     = false;

		foreach ( $sites as $site ) {
			if ( (int) $site['id'] === (int) $id ) {
				$found = true;
				continue;
			}
			$remaining[] = $site;
		}

		if ( $found ) {
			self::write( $remaining );
		}

		return $found;
	}

	/**
	 * Record a successful connection test: store discovered scopes and sync time.
	 *
	 * @param int      $id     Site id.
	 * @param string[] $scopes Scopes reported by the remote token.
	 * @return void
	 */
	public static function record_test_result( $id, array $scopes ) {
		$sites = self::read();

		foreach ( $sites as $index => $site ) {
			if ( (int) $site['id'] === (int) $id ) {
				$site['scopes']       = array_values( array_map( 'sanitize_text_field', $scopes ) );
				$site['status']       = 'connected';
				$site['last_sync_at'] = current_time( 'mysql', true );
				$sites[ $index ]      = $site;
				break;
			}
		}

		self::write( $sites );
	}

	/**
	 * Mark a connected site as failing its connection test.
	 *
	 * @param int $id Site id.
	 * @return void
	 */
	public static function mark_failed( $id ) {
		$sites = self::read();

		foreach ( $sites as $index => $site ) {
			if ( (int) $site['id'] === (int) $id ) {
				$site['status']  = 'error';
				$sites[ $index ] = $site;
				break;
			}
		}

		self::write( $sites );
	}

	/**
	 * Convert a record to a safe array for admin responses.
	 *
	 * Never returns the raw token; exposes only whether one is set and a short
	 * hint (last 4 characters).
	 *
	 * @param array $record Connected site record.
	 * @return array
	 */
	public static function to_array( $record ) {
		$token = (string) ( $record['token'] ?? '' );

		return array(
			'id'           => (int) $record['id'],
			'label'        => $record['label'] ?? '',
			'base_url'     => $record['base_url'] ?? '',
			'scopes'       => isset( $record['scopes'] ) && is_array( $record['scopes'] ) ? $record['scopes'] : array(),
			'status'       => $record['status'] ?? 'unverified',
			'created_at'   => $record['created_at'] ?? '',
			'last_sync_at' => $record['last_sync_at'] ?? null,
			'has_token'    => '' !== $token,
			'token_hint'   => '' !== $token ? substr( $token, -4 ) : '',
		);
	}
}
