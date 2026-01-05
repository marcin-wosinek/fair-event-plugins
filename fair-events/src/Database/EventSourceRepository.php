<?php
/**
 * Event Source Repository for database operations
 *
 * @package FairEvents
 */

namespace FairEvents\Database;

defined( 'WPINC' ) || die;

/**
 * Handles event source database operations
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventSourceRepository {

	/**
	 * Get table name
	 *
	 * @return string Table name with prefix.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_event_sources';
	}

	/**
	 * Create a new event source
	 *
	 * @param string $name Source name.
	 * @param string $source_type Source type (categories, ical_url, meetup_api).
	 * @param array  $config Configuration array.
	 * @param string $color Hex color code.
	 * @param bool   $enabled Whether source is enabled.
	 * @return int|false Source ID on success, false on failure.
	 */
	public function create( $name, $source_type, $config, $color = '#000000', $enabled = true ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->insert(
			$table_name,
			array(
				'name'        => $name,
				'source_type' => $source_type,
				'config'      => wp_json_encode( $config ),
				'color'       => $color,
				'enabled'     => $enabled ? 1 : 0,
			),
			array( '%s', '%s', '%s', '%s', '%d' )
		);

		return $result ? $wpdb->insert_id : false;
	}

	/**
	 * Update an existing event source
	 *
	 * @param int    $id Source ID.
	 * @param string $name Source name.
	 * @param string $source_type Source type.
	 * @param array  $config Configuration array.
	 * @param string $color Hex color code.
	 * @param bool   $enabled Whether source is enabled.
	 * @return bool True on success, false on failure.
	 */
	public function update( $id, $name, $source_type, $config, $color, $enabled ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->update(
			$table_name,
			array(
				'name'        => $name,
				'source_type' => $source_type,
				'config'      => wp_json_encode( $config ),
				'color'       => $color,
				'enabled'     => $enabled ? 1 : 0,
			),
			array( 'id' => $id ),
			array( '%s', '%s', '%s', '%s', '%d' ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Delete an event source
	 *
	 * @param int $id Source ID.
	 * @return bool True on success, false on failure.
	 */
	public function delete( $id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->delete(
			$table_name,
			array( 'id' => $id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Get event source by ID
	 *
	 * @param int $id Source ID.
	 * @return array|null Source data with decoded config, or null if not found.
	 */
	public function get_by_id( $id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$source = $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', $table_name, $id ),
			ARRAY_A
		);

		if ( $source ) {
			$source['config']  = json_decode( $source['config'], true );
			$source['enabled'] = (bool) $source['enabled'];
		}

		return $source;
	}

	/**
	 * Get all event sources
	 *
	 * @param bool $enabled_only Whether to fetch only enabled sources.
	 * @return array Array of sources with decoded config.
	 */
	public function get_all( $enabled_only = false ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		if ( $enabled_only ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$sources = $wpdb->get_results(
				$wpdb->prepare( 'SELECT * FROM %i WHERE enabled = %d ORDER BY created_at DESC', $table_name, 1 ),
				ARRAY_A
			);
		} else {
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$sources = $wpdb->get_results(
				$wpdb->prepare( 'SELECT * FROM %i ORDER BY created_at DESC', $table_name ),
				ARRAY_A
			);
		}

		foreach ( $sources as &$source ) {
			$source['config']  = json_decode( $source['config'], true );
			$source['enabled'] = (bool) $source['enabled'];
		}

		return $sources;
	}

	/**
	 * Get sources by type
	 *
	 * @param string $source_type Source type to filter by.
	 * @param bool   $enabled_only Whether to fetch only enabled sources.
	 * @return array Array of sources.
	 */
	public function get_by_type( $source_type, $enabled_only = false ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		if ( $enabled_only ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$sources = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE source_type = %s AND enabled = %d ORDER BY created_at DESC',
					$table_name,
					$source_type,
					1
				),
				ARRAY_A
			);
		} else {
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$sources = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE source_type = %s ORDER BY created_at DESC',
					$table_name,
					$source_type
				),
				ARRAY_A
			);
		}

		foreach ( $sources as &$source ) {
			$source['config']  = json_decode( $source['config'], true );
			$source['enabled'] = (bool) $source['enabled'];
		}

		return $sources;
	}
}
