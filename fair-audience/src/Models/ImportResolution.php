<?php
/**
 * ImportResolution Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * ImportResolution model for tracking manual duplicate resolutions.
 */
class ImportResolution {

	/**
	 * Resolution record ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Original filename of import.
	 *
	 * @var string
	 */
	public $filename;

	/**
	 * Original conflicting email.
	 *
	 * @var string
	 */
	public $original_email;

	/**
	 * Excel row number where duplicate appeared.
	 *
	 * @var int
	 */
	public $import_row_number;

	/**
	 * Name from that row.
	 *
	 * @var string
	 */
	public $resolved_name;

	/**
	 * Surname from that row.
	 *
	 * @var string
	 */
	public $resolved_surname;

	/**
	 * User-provided resolution email.
	 *
	 * @var string
	 */
	public $resolved_email;

	/**
	 * Resolution action type.
	 *
	 * @var string
	 */
	public $resolution_action;

	/**
	 * Created participant ID (null if skipped).
	 *
	 * @var int|null
	 */
	public $participant_id;

	/**
	 * Created timestamp.
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Updated timestamp.
	 *
	 * @var string
	 */
	public $updated_at;

	/**
	 * Constructor.
	 *
	 * @param array $data Optional data to populate.
	 */
	public function __construct( $data = array() ) {
		if ( ! empty( $data ) ) {
			$this->populate( $data );
		}
	}

	/**
	 * Populate from data array.
	 *
	 * @param array $data Data array.
	 */
	public function populate( $data ) {
		$this->id                = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->filename          = isset( $data['filename'] ) ? $data['filename'] : '';
		$this->original_email    = isset( $data['original_email'] ) ? $data['original_email'] : '';
		$this->import_row_number = isset( $data['import_row_number'] ) ? (int) $data['import_row_number'] : 0;
		$this->resolved_name     = isset( $data['resolved_name'] ) ? $data['resolved_name'] : '';
		$this->resolved_surname  = isset( $data['resolved_surname'] ) ? $data['resolved_surname'] : '';
		$this->resolved_email    = isset( $data['resolved_email'] ) ? $data['resolved_email'] : '';
		$this->resolution_action = isset( $data['resolution_action'] ) ? $data['resolution_action'] : 'edit';
		$this->participant_id    = isset( $data['participant_id'] ) ? (int) $data['participant_id'] : null;
		$this->created_at        = isset( $data['created_at'] ) ? $data['created_at'] : '';
		$this->updated_at        = isset( $data['updated_at'] ) ? $data['updated_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_import_resolutions';

		// Validate resolution_action.
		if ( ! in_array( $this->resolution_action, array( 'edit', 'skip', 'alias' ), true ) ) {
			$this->resolution_action = 'edit';
		}

		$data = array(
			'filename'          => $this->filename,
			'original_email'    => $this->original_email,
			'import_row_number' => $this->import_row_number,
			'resolved_name'     => $this->resolved_name,
			'resolved_surname'  => $this->resolved_surname,
			'resolved_email'    => $this->resolved_email,
			'resolution_action' => $this->resolution_action,
			'participant_id'    => $this->participant_id,
		);

		$format = array( '%s', '%s', '%d', '%s', '%s', '%s', '%s', '%d' );

		if ( $this->id ) {
			// Update existing.
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $this->id ),
				$format,
				array( '%d' )
			);
		} else {
			// Insert new.
			$result = $wpdb->insert( $table_name, $data, $format );
			if ( $result ) {
				$this->id = $wpdb->insert_id;
			}
		}

		return $result !== false;
	}
}
