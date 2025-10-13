/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';

/**
 * Internal dependencies
 */
import UploadStep from './components/UploadStep.js';

const STEPS = {
	UPLOAD: 0,
	MAPPING: 1,
	PREVIEW: 2,
	GROUPS: 3,
	CONFIRM: 4,
};

/**
 * Import Users Wizard Component - Multi-step wizard for importing users from CSV
 *
 * @return {JSX.Element} The Import Users wizard component
 */
export default function ImportUsers() {
	const [currentStep, setCurrentStep] = useState(STEPS.UPLOAD);
	const [csvFile, setCsvFile] = useState(null);
	const [csvData, setCsvData] = useState([]);
	const [fieldMapping, setFieldMapping] = useState({});
	const [userData, setUserData] = useState([]);
	const [userActions, setUserActions] = useState({});
	const [selectedGroups, setSelectedGroups] = useState([]);
	const [validationErrors, setValidationErrors] = useState({});
	const [importResult, setImportResult] = useState(null);

	// Load state from session storage on mount
	useEffect(() => {
		const savedState = sessionStorage.getItem(
			'fair-membership-import-state'
		);
		if (savedState) {
			try {
				const state = JSON.parse(savedState);
				setCurrentStep(state.currentStep || STEPS.UPLOAD);
				setCsvData(state.csvData || []);
				setFieldMapping(state.fieldMapping || {});
				setUserData(state.userData || []);
				setUserActions(state.userActions || {});
				setSelectedGroups(state.selectedGroups || []);
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error('Failed to restore import state:', err);
			}
		}
	}, []);

	// Save state to session storage on changes
	useEffect(() => {
		const state = {
			currentStep,
			csvData,
			fieldMapping,
			userData,
			userActions,
			selectedGroups,
		};
		sessionStorage.setItem(
			'fair-membership-import-state',
			JSON.stringify(state)
		);
	}, [
		currentStep,
		csvData,
		fieldMapping,
		userData,
		userActions,
		selectedGroups,
	]);

	const handleUploadComplete = (file, data) => {
		setCsvFile(file);
		setCsvData(data);
		setCurrentStep(STEPS.MAPPING);
	};

	const handleMappingComplete = (mapping) => {
		setFieldMapping(mapping);
		setCurrentStep(STEPS.PREVIEW);
	};

	const handlePreviewComplete = (users, actions) => {
		setUserData(users);
		setUserActions(actions);
		setCurrentStep(STEPS.GROUPS);
	};

	const handleGroupsComplete = (groups) => {
		setSelectedGroups(groups);
		setCurrentStep(STEPS.CONFIRM);
	};

	const handleImportComplete = (result) => {
		setImportResult(result);
		// Clear session storage after successful import
		sessionStorage.removeItem('fair-membership-import-state');
	};

	const handleReset = () => {
		setCurrentStep(STEPS.UPLOAD);
		setCsvFile(null);
		setCsvData([]);
		setFieldMapping({});
		setUserData([]);
		setUserActions({});
		setSelectedGroups([]);
		setValidationErrors({});
		setImportResult(null);
		sessionStorage.removeItem('fair-membership-import-state');
	};

	return (
		<div className="wrap">
			<h1>{__('Import Users', 'fair-membership')}</h1>

			{/* Step indicator */}
			<div className="fair-membership-import-steps">
				<ol>
					<li
						className={currentStep === STEPS.UPLOAD ? 'active' : ''}
					>
						{__('Upload CSV', 'fair-membership')}
					</li>
					<li
						className={
							currentStep === STEPS.MAPPING ? 'active' : ''
						}
					>
						{__('Map Fields', 'fair-membership')}
					</li>
					<li
						className={
							currentStep === STEPS.PREVIEW ? 'active' : ''
						}
					>
						{__('Preview & Edit', 'fair-membership')}
					</li>
					<li
						className={currentStep === STEPS.GROUPS ? 'active' : ''}
					>
						{__('Assign Groups', 'fair-membership')}
					</li>
					<li
						className={
							currentStep === STEPS.CONFIRM ? 'active' : ''
						}
					>
						{__('Confirm Import', 'fair-membership')}
					</li>
				</ol>
			</div>

			{/* Step content */}
			<div className="fair-membership-import-content">
				{currentStep === STEPS.UPLOAD && (
					<UploadStep onComplete={handleUploadComplete} />
				)}
				{currentStep === STEPS.MAPPING && (
					<div>
						<p>
							{__(
								'Mapping step - Coming in Phase 2',
								'fair-membership'
							)}
						</p>
					</div>
				)}
				{currentStep === STEPS.PREVIEW && (
					<div>
						<p>
							{__(
								'Preview step - Coming in Phase 2',
								'fair-membership'
							)}
						</p>
					</div>
				)}
				{currentStep === STEPS.GROUPS && (
					<div>
						<p>
							{__(
								'Groups step - Coming in Phase 3',
								'fair-membership'
							)}
						</p>
					</div>
				)}
				{currentStep === STEPS.CONFIRM && (
					<div>
						<p>
							{__(
								'Confirm step - Coming in Phase 3',
								'fair-membership'
							)}
						</p>
					</div>
				)}
			</div>

			{/* Reset button for testing */}
			{currentStep !== STEPS.UPLOAD && (
				<button
					type="button"
					className="button"
					onClick={handleReset}
					style={{ marginTop: '20px' }}
				>
					{__('Reset & Start Over', 'fair-membership')}
				</button>
			)}
		</div>
	);
}
