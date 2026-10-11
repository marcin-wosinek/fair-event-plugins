<?php
/**
 * Mollie settlement CSV parser and validator
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Settlements;

defined( 'WPINC' ) || die;

/**
 * Reads a Mollie settlement CSV export into the settlement model.
 *
 * Nothing is guessed: a file that is not UTF-8, lacks the documented columns,
 * mixes settlements, or holds a value that cannot be read exactly is refused
 * with the row that caused it. Consumer names and bank details are never
 * read into the result, and the upload itself is not kept.
 */
class CsvParser {

	/**
	 * Largest accepted upload.
	 */
	const MAX_BYTES = 2097152;

	/**
	 * Most problems reported for one file.
	 */
	const MAX_ERRORS = 20;

	/**
	 * Lines searched for the header row; exports may start with a title line.
	 */
	const HEADER_SEARCH_ROWS = 10;

	/**
	 * Documented column headers per export language, lowercased.
	 */
	const HEADERS = array(
		'en' => array(
			'date'                 => 'date',
			'method'               => 'payment method',
			'currency'             => 'currency',
			'amount'               => 'amount',
			'status'               => 'status',
			'id'                   => 'id',
			'description'          => 'description',
			'settlement_currency'  => 'settlement currency',
			'settlement_amount'    => 'settlement amount',
			'settlement_reference' => 'settlement reference',
		),
		'nl' => array(
			'date'                 => 'datum',
			'method'               => 'betaalmethode',
			'currency'             => 'valuta',
			'amount'               => 'bedrag',
			'status'               => 'status',
			'id'                   => 'id',
			'description'          => 'omschrijving',
			'settlement_currency'  => 'uitbetalingsvaluta',
			'settlement_amount'    => 'uitbetalingsbedrag',
			'settlement_reference' => 'uitbetalingsreferentie',
		),
	);

	/**
	 * Columns a file must have.
	 */
	const REQUIRED = array( 'id', 'amount', 'status', 'settlement_reference' );

	/**
	 * External reference prefixes and the movement they identify.
	 */
	const ID_PREFIXES = array(
		'tr'  => Movements::TYPE_PAYMENT,
		'cpt' => Movements::TYPE_CAPTURE,
		're'  => Movements::TYPE_REFUND,
		'chb' => Movements::TYPE_CHARGEBACK,
	);

	/**
	 * Parse and validate a settlement CSV.
	 *
	 * @param string $contents Raw file contents.
	 * @return array {
	 *     @type string      $format    Export language, `en` or `nl`.
	 *     @type array       $facts     Settlement facts; unknown values are null.
	 *     @type array[]     $movements Movements with identities.
	 *     @type array       $totals    Totals per movement type.
	 *     @type string      $hash      Content hash.
	 * }
	 * @throws CsvValidationException When the file cannot be imported as it is.
	 */
	public static function parse( $contents ) {
		$contents = (string) $contents;

		if ( strlen( $contents ) > self::MAX_BYTES ) {
			self::fail( 'csv_too_large', __( 'The file is larger than 2 MB. Export one settlement at a time.', 'fair-payments-connector' ) );
		}

		// Drop a UTF-8 byte order mark.
		if ( "\xEF\xBB\xBF" === substr( $contents, 0, 3 ) ) {
			$contents = substr( $contents, 3 );
		}

		if ( '' === trim( $contents ) ) {
			self::fail( 'csv_empty', __( 'The file is empty.', 'fair-payments-connector' ) );
		}

		if ( ! mb_check_encoding( $contents, 'UTF-8' ) || false !== strpos( $contents, "\0" ) ) {
			self::fail( 'csv_encoding', __( 'The file is not UTF-8 text. Export the settlement from Mollie as CSV and upload it unchanged.', 'fair-payments-connector' ) );
		}

		$rows   = self::read_rows( $contents );
		$header = self::find_header( $rows );
		$errors = array();
		$parsed = array();

		$column_count = count( $rows[ $header['index'] ] );

		foreach ( $rows as $index => $row ) {
			if ( $index <= $header['index'] || self::is_blank( $row ) ) {
				continue;
			}

			$line = $index + 1;

			if ( count( $row ) !== $column_count ) {
				$errors[] = self::error(
					'csv_row_structure',
					/* translators: 1: number of columns found, 2: number of columns expected */
					sprintf( __( 'The row has %1$d columns, but the header has %2$d.', 'fair-payments-connector' ), count( $row ), $column_count ),
					$line
				);
			} else {
				$parsed[ $line ] = self::read_cells( $row, $header['columns'] );
			}

			if ( count( $errors ) >= self::MAX_ERRORS ) {
				throw new CsvValidationException( $errors ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- carries a list of problems for the REST response, not output.
			}
		}

		if ( empty( $parsed ) && empty( $errors ) ) {
			self::fail( 'csv_no_rows', __( 'The file has a header but no settlement rows.', 'fair-payments-connector' ) );
		}

		$context = self::settlement_context( $parsed, $header['columns'], $errors );

		$movements = array();
		foreach ( $parsed as $line => $cells ) {
			$movement = self::to_movement( $cells, $context['currency'], $line, $errors );
			if ( null !== $movement ) {
				$movements[] = $movement;
			}
			if ( count( $errors ) >= self::MAX_ERRORS ) {
				break;
			}
		}

		if ( ! empty( $errors ) ) {
			throw new CsvValidationException( array_slice( $errors, 0, self::MAX_ERRORS ) ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- carries a list of problems for the REST response, not output.
		}

		$movements = Movements::assign_identities( $movements );
		$facts     = array(
			'provider_id' => null,
			'reference'   => $context['reference'],
			'currency'    => $context['currency'],
			// The export lists movements, not the payout itself.
			'amount'      => null,
			'status'      => null,
			'created_at'  => null,
			'settled_at'  => null,
			'invoice_id'  => null,
			'balance_id'  => null,
		);

		return array(
			'format'    => $header['format'],
			'facts'     => $facts,
			'movements' => $movements,
			'totals'    => Movements::totals( $movements ),
			'hash'      => Movements::content_hash( $facts, $movements ),
		);
	}

	/**
	 * Split the file into rows of cells.
	 *
	 * @param string $contents UTF-8 file contents.
	 * @return array[]
	 */
	private static function read_rows( $contents ) {
		// A title line may precede the header, so judge by the busiest early line.
		$commas     = 0;
		$semicolons = 0;
		foreach ( array_slice( preg_split( '/\r\n|\r|\n/', $contents, self::HEADER_SEARCH_ROWS + 1 ), 0, self::HEADER_SEARCH_ROWS ) as $line ) {
			$commas     = max( $commas, substr_count( $line, ',' ) );
			$semicolons = max( $semicolons, substr_count( $line, ';' ) );
		}
		$delimiter = $semicolons > $commas ? ';' : ',';

		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen -- in-memory stream, no filesystem access.
		$stream = fopen( 'php://temp', 'r+' );
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fwrite -- in-memory stream.
		fwrite( $stream, $contents );
		rewind( $stream );

		$rows = array();
		while ( true ) {
			$row = fgetcsv( $stream, 0, $delimiter, '"', '' );
			if ( false === $row ) {
				break;
			}
			$rows[] = array( null ) === $row ? array() : $row;
		}
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- in-memory stream.
		fclose( $stream );

		return $rows;
	}

	/**
	 * Locate the header row and map its columns.
	 *
	 * @param array[] $rows File rows.
	 * @return array{index: int, format: string, columns: array<string, int>}
	 * @throws CsvValidationException When no documented header is found.
	 */
	private static function find_header( array $rows ) {
		$best_missing = null;

		foreach ( array_slice( $rows, 0, self::HEADER_SEARCH_ROWS, true ) as $index => $row ) {
			$cells = array();
			foreach ( $row as $position => $cell ) {
				$name = strtolower( trim( (string) $cell ) );
				if ( '' !== $name && ! isset( $cells[ $name ] ) ) {
					$cells[ $name ] = $position;
				}
			}

			foreach ( self::HEADERS as $format => $names ) {
				$columns = array();
				foreach ( $names as $field => $name ) {
					if ( isset( $cells[ $name ] ) ) {
						$columns[ $field ] = $cells[ $name ];
					}
				}

				$missing = array();
				foreach ( self::REQUIRED as $field ) {
					if ( ! isset( $columns[ $field ] ) ) {
						$missing[] = $names[ $field ];
					}
				}

				if ( empty( $missing ) ) {
					return array(
						'index'   => $index,
						'format'  => $format,
						'columns' => $columns,
					);
				}

				// Remember the closest match that at least looks like a header.
				if ( count( $missing ) < count( self::REQUIRED ) && ( null === $best_missing || count( $missing ) < count( $best_missing ) ) ) {
					$best_missing = $missing;
				}
			}
		}

		if ( null !== $best_missing ) {
			self::fail(
				'csv_headers_missing',
				sprintf(
					/* translators: %s: comma-separated list of column names */
					__( 'The file is missing required columns: %s. Export the settlement from Mollie in English or Dutch and upload it unchanged.', 'fair-payments-connector' ),
					implode( ', ', $best_missing )
				)
			);
		}

		self::fail( 'csv_headers_unsupported', __( 'This does not look like a Mollie settlement export. Only the English and Dutch CSV exports are supported.', 'fair-payments-connector' ) );
	}

	/**
	 * Read one row's cells by field name.
	 *
	 * @param array $row     Row cells.
	 * @param array $columns Field to column index map.
	 * @return array<string, string|null> Trimmed values; null for a missing column.
	 */
	private static function read_cells( array $row, array $columns ) {
		$cells = array();
		foreach ( array_keys( self::HEADERS['en'] ) as $field ) {
			$cells[ $field ] = isset( $columns[ $field ] ) ? trim( (string) $row[ $columns[ $field ] ] ) : null;
		}

		return $cells;
	}

	/**
	 * Establish the one settlement and settlement currency the file is about.
	 *
	 * @param array[] $parsed  Parsed rows keyed by line number.
	 * @param array   $columns Field to column index map.
	 * @param array[] $errors  Problems found, added to in place.
	 * @return array{reference: string|null, currency: string|null}
	 */
	private static function settlement_context( array $parsed, array $columns, array &$errors ) {
		$references = array();
		$currencies = array();
		$field      = isset( $columns['settlement_currency'] ) ? 'settlement_currency' : 'currency';

		foreach ( $parsed as $line => $cells ) {
			if ( '' !== (string) $cells['settlement_reference'] ) {
				$references[ $cells['settlement_reference'] ] = $line;
			}
			if ( '' !== (string) $cells[ $field ] ) {
				$currencies[ strtoupper( $cells[ $field ] ) ] = $line;
			}
		}

		$reference = null;
		if ( empty( $references ) ) {
			$errors[] = self::error( 'csv_reference_missing', __( 'No settlement reference was found in the file.', 'fair-payments-connector' ) );
		} elseif ( count( $references ) > 1 ) {
			$errors[] = self::error(
				'csv_multiple_settlements',
				__( 'The file contains more than one settlement reference. Upload one settlement at a time.', 'fair-payments-connector' ),
				max( $references )
			);
		} else {
			$reference = (string) array_key_first( $references );
			if ( 1 !== preg_match( '/^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,62}$/', $reference ) ) {
				$errors[]  = self::error( 'csv_reference_invalid', __( 'The settlement reference is not in a recognized format.', 'fair-payments-connector' ), $references[ $reference ] );
				$reference = null;
			}
		}

		$currency = null;
		if ( 'settlement_currency' === $field && count( $currencies ) > 1 ) {
			$errors[] = self::error(
				'csv_multiple_settlement_currencies',
				__( 'The file contains more than one settlement currency. Upload one settlement at a time.', 'fair-payments-connector' ),
				max( $currencies )
			);
		} elseif ( 1 === count( $currencies ) ) {
			$currency = (string) array_key_first( $currencies );
			if ( ! Decimal::is_currency( $currency ) ) {
				$errors[] = self::error(
					'csv_currency_invalid',
					/* translators: %s: value found in the currency column */
					sprintf( __( '"%s" is not a currency code.', 'fair-payments-connector' ), $currency ),
					$currencies[ $currency ]
				);
				$currency = null;
			}
		}

		return array(
			'reference' => $reference,
			'currency'  => $currency,
		);
	}

	/**
	 * Convert one parsed row into a movement.
	 *
	 * @param array       $cells               Parsed cells.
	 * @param string|null $settlement_currency Settlement currency, when established.
	 * @param int         $line                Line number in the file.
	 * @param array[]     $errors              Problems found, added to in place.
	 * @return array|null Movement, or null for a row that carries nothing.
	 */
	private static function to_movement( array $cells, $settlement_currency, $line, array &$errors ) {
		$id          = (string) $cells['id'];
		$description = (string) $cells['description'];

		if ( '' === $id && '' === (string) $cells['amount'] && '' === (string) $cells['settlement_amount'] && '' === $description ) {
			return null;
		}

		$currency = null;
		if ( '' !== (string) $cells['currency'] ) {
			$currency = strtoupper( $cells['currency'] );
			if ( ! Decimal::is_currency( $currency ) ) {
				$errors[] = self::error(
					'csv_currency_invalid',
					/* translators: %s: value found in the currency column */
					sprintf( __( '"%s" is not a currency code.', 'fair-payments-connector' ), $cells['currency'] ),
					$line
				);
				return null;
			}
		}

		$amount            = self::read_amount( $cells['amount'], $currency, $line, $errors );
		$settlement_amount = self::read_amount( $cells['settlement_amount'], $settlement_currency, $line, $errors );
		if ( false === $amount || false === $settlement_amount ) {
			return null;
		}

		$type         = Movements::TYPE_UNKNOWN;
		$is_aggregate = false;
		$needs_review = false;
		$status       = strtolower( (string) $cells['status'] );

		if ( '' !== $id ) {
			if ( 1 !== preg_match( '/^([a-z]{2,4})_[A-Za-z0-9]{4,40}$/', $id, $matches ) ) {
				$errors[] = self::error(
					'csv_reference_invalid',
					/* translators: %s: value found in the ID column */
					sprintf( __( '"%s" is not a Mollie reference.', 'fair-payments-connector' ), $id ),
					$line
				);
				return null;
			}

			if ( isset( self::ID_PREFIXES[ $matches[1] ] ) ) {
				$type = self::ID_PREFIXES[ $matches[1] ];
				// Some exports list a refund or chargeback under its payment.
				if ( Movements::TYPE_PAYMENT === $type ) {
					if ( false !== strpos( $status, 'refund' ) || false !== strpos( $status, 'terugbetaal' ) ) {
						$type = Movements::TYPE_REFUND;
					} elseif ( false !== strpos( $status, 'chargeback' ) || false !== strpos( $status, 'charged_back' ) || false !== strpos( $status, 'terugboek' ) ) {
						$type = Movements::TYPE_CHARGEBACK;
					}
				}
			} else {
				$needs_review = true;
			}
		} else {
			// A row without a reference is a summed line, not one movement.
			$is_aggregate = true;
			$type         = 1 === preg_match( '/(\bfees?|\bcosts?|kosten|\bcommissi(on|e)|\bvat|\bbtw)\b/i', $description )
				? Movements::TYPE_FEE
				: Movements::TYPE_ADJUSTMENT;
		}

		return Movements::make(
			array(
				'type'                => $type,
				'is_aggregate'        => $is_aggregate,
				'external_id'         => '' === $id ? null : $id,
				'payment_reference'   => 0 === strpos( $id, 'tr_' ) ? $id : null,
				'amount'              => $amount,
				'currency'            => $currency,
				'settlement_amount'   => $settlement_amount,
				'settlement_currency' => null === $settlement_amount ? null : $settlement_currency,
				'description'         => function_exists( 'mb_substr' ) ? mb_substr( $description, 0, 255 ) : substr( $description, 0, 255 ),
				'provider_status'     => '' === $status ? null : substr( $status, 0, 32 ),
				'occurred_at'         => self::read_date( $cells['date'] ),
				'needs_review'        => $needs_review,
				'raw_type'            => '' === (string) $cells['method'] ? null : substr( strtolower( $cells['method'] ), 0, 64 ),
			)
		);
	}

	/**
	 * Read an amount cell exactly.
	 *
	 * @param string|null $raw      Cell value; null when the column is absent.
	 * @param string|null $currency Currency the amount is in, when known.
	 * @param int         $line     Line number in the file.
	 * @param array[]     $errors   Problems found, added to in place.
	 * @return string|null|false Canonical amount, null when unknown, false when invalid.
	 */
	private static function read_amount( $raw, $currency, $line, array &$errors ) {
		if ( null === $raw || '' === $raw ) {
			return null;
		}

		$amount = Decimal::normalize( $raw, $currency );
		if ( null === $amount ) {
			$errors[] = self::error(
				'csv_amount_invalid',
				/* translators: %s: value found in an amount column */
				sprintf( __( '"%s" is not an amount that can be read exactly. Amounts must be plain numbers such as 12.50, without thousands separators.', 'fair-payments-connector' ), $raw ),
				$line
			);
			return false;
		}

		return $amount;
	}

	/**
	 * Read a date cell, keeping it as written (the export states no timezone).
	 *
	 * @param string|null $raw Cell value.
	 * @return string|null `Y-m-d H:i:s`, or null when absent or unreadable.
	 */
	private static function read_date( $raw ) {
		if ( null === $raw || 1 !== preg_match( '/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/', $raw, $m ) ) {
			return null;
		}

		if ( ! checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) ) {
			return null;
		}

		return sprintf( '%s-%s-%s %s:%s:%s', $m[1], $m[2], $m[3], $m[4] ?? '00', $m[5] ?? '00', $m[6] ?? '00' );
	}

	/**
	 * Whether a row has no content.
	 *
	 * @param array $row Row cells.
	 * @return bool
	 */
	private static function is_blank( array $row ) {
		foreach ( $row as $cell ) {
			if ( '' !== trim( (string) $cell ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Build one problem.
	 *
	 * @param string   $code    Machine-readable code.
	 * @param string   $message Message for the administrator.
	 * @param int|null $row     Line number in the file, when it applies to one.
	 * @return array
	 */
	private static function error( $code, $message, $row = null ) {
		return array(
			'code'    => $code,
			'message' => $message,
			'row'     => $row,
		);
	}

	/**
	 * Refuse the file for one reason.
	 *
	 * @param string $code    Machine-readable code.
	 * @param string $message Message for the administrator.
	 * @return never
	 * @throws CsvValidationException Always.
	 */
	private static function fail( $code, $message ) {
		throw new CsvValidationException( array( self::error( $code, $message ) ) ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- carries a list of problems for the REST response, not output.
	}
}
