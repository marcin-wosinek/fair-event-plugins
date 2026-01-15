<?php
/**
 * ImportResolution Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\ImportResolution;

defined( 'WPINC' ) || die;

/**
 * Repository for import resolution records.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ImportResolutionRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_import_resolutions';
	}

	/**
	 * Find existing resolution for a specific duplicate.
	 *
	 * @param string $original_email Original conflicting email.
	 * @param string $name           Name from row.
	 * @param string $surname        Surname from row.
	 * @return ImportResolution|null Found resolution or null.
	 */
	public function find_resolution( $original_email, $name, $surname ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE original_email = %s AND resolved_name = %s AND resolved_surname = %s ORDER BY created_at DESC LIMIT 1',
				$table_name,
				$original_email,
				$name,
				$surname
			),
			ARRAY_A
		);

		return $result ? new ImportResolution( $result ) : null;
	}

	/**
	 * Find existing resolution by original email and row number.
	 *
	 * Since Entradium exports have different filenames but same row order,
	 * we can match by original_email and import_row_number.
	 *
	 * @param string $original_email Original conflicting email.
	 * @param int    $row_number     Import row number.
	 * @return ImportResolution|null Found resolution or null.
	 */
	public function find_by_email_and_row( $original_email, $row_number ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE original_email = %s AND import_row_number = %d ORDER BY created_at DESC LIMIT 1',
				$table_name,
				$original_email,
				$row_number
			),
			ARRAY_A
		);

		return $result ? new ImportResolution( $result ) : null;
	}

	/**
	 * Save a new resolution.
	 *
	 * @param array $data Resolution data.
	 * @return int|false ID of created resolution or false.
	 */
	public function create( $data ) {
		$resolution = new ImportResolution( $data );
		return $resolution->save() ? $resolution->id : false;
	}

	/**
	 * Get all resolutions for a specific filename.
	 *
	 * @param string $filename Filename to query.
	 * @return ImportResolution[] Array of resolutions.
	 */
	public function get_by_filename( $filename ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE filename = %s ORDER BY created_at DESC',
				$table_name,
				$filename
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new ImportResolution( $row );
			},
			$results
		);
	}
}
