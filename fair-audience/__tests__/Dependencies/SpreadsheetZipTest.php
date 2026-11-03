<?php
/**
 * Spreadsheet ZIP output smoke test.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Dependencies;

use PHPUnit\Framework\TestCase;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use ZipArchive;

/**
 * The bundled spreadsheet library writes XLSX files through ZipStream-PHP.
 * This checks the locked versions still produce a valid archive together.
 */
class SpreadsheetZipTest extends TestCase {

	/**
	 * Temporary XLSX path.
	 *
	 * @var string
	 */
	private $path;

	/**
	 * Reserves a temporary file for the workbook.
	 */
	protected function setUp(): void {
		$this->path = tempnam( sys_get_temp_dir(), 'fair-audience-xlsx-' );
	}

	/**
	 * Removes the temporary file.
	 */
	protected function tearDown(): void {
		if ( is_file( $this->path ) ) {
			unlink( $this->path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink -- No WordPress in unit tests.
		}
	}

	/**
	 * A written workbook is a ZIP archive that reads back with its cells.
	 */
	public function test_xlsx_writer_produces_a_readable_zip_archive(): void {
		$spreadsheet = new Spreadsheet();
		$sheet       = $spreadsheet->getActiveSheet();
		$sheet->setCellValue( 'A1', 'Email' );
		$sheet->setCellValue( 'A2', 'ada@example.com' );

		( new Xlsx( $spreadsheet ) )->save( $this->path );

		$zip = new ZipArchive();
		$this->assertTrue( $zip->open( $this->path ) );
		$this->assertNotFalse( $zip->locateName( '[Content_Types].xml' ) );
		$this->assertNotFalse( $zip->locateName( 'xl/workbook.xml' ) );
		$this->assertNotFalse( $zip->locateName( 'xl/worksheets/sheet1.xml' ) );
		$zip->close();

		$read = IOFactory::load( $this->path );
		$this->assertSame( 'ada@example.com', $read->getActiveSheet()->getCell( 'A2' )->getValue() );
	}
}
