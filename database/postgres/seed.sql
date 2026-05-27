-- ============================================================
--  Sample seed data — Cassian & Associates Ltd (Tanzania)
--  Idempotent: truncates first. Passwords hashed with pgcrypto
--  (bcrypt $2a$) so they verify with the app's bcryptjs.
--  Default password for every user: Password123!
-- ============================================================

TRUNCATE firms, roles, permissions RESTART IDENTITY CASCADE;

DO $$
DECLARE
  v_firm  uuid;
  v_admin uuid; v_neema uuid;
  v_client uuid; v_eng uuid;
  pw text := crypt('Password123!', gen_salt('bf'));
  stages text[] := ARRAY['Planning','Engagement Letter','Fieldwork','Manager Review',
                         'Partner Review','Draft Financial Report','Client Sign-off',
                         'ROI Submission','Completed'];
  ci int; i int; rec record;
BEGIN
  -- Firm
  INSERT INTO firms(name, tin, vrn, address, settings)
  VALUES ('Cassian & Associates Limited','100-200-300','40-000111-C',
          'Plot 12, Ohio Street, Dar es Salaam', '{"currency":"TZS"}'::jsonb)
  RETURNING id INTO v_firm;

  -- Roles (users.role references roles.name)
  INSERT INTO roles(name, description) VALUES
    ('Admin','Full system access'),
    ('Partner','All clients, engagement sign-off'),
    ('Manager','Assigned clients, manager review'),
    ('Senior Auditor','Fieldwork & working papers'),
    ('Accountant','Accounting module'),
    ('Tax Consultant','Tax module & filings'),
    ('Staff','Limited task execution'),
    ('Client','Read-only portal');

  -- Permission catalogue (RBAC is also enforced in code)
  INSERT INTO permissions(code, module, description) VALUES
    ('client.read','clients','View clients'),('client.create','clients','Create clients'),
    ('client.update','clients','Edit clients'),('client.delete','clients','Delete clients'),
    ('engagement.read','audit','View engagements'),('engagement.update','audit','Edit engagements'),
    ('workflow.advance','audit','Advance workflow'),('workflow.manager_review','audit','Clear manager review'),
    ('workflow.partner_review','audit','Partner sign-off'),
    ('task.read','tasks','View tasks'),('task.create','tasks','Create tasks'),
    ('task.update','tasks','Edit tasks'),('task.delete','tasks','Delete tasks'),
    ('document.read','documents','View documents'),('document.upload','documents','Upload documents'),
    ('document.delete','documents','Delete documents'),('document.approve','documents','Approve documents'),
    ('tax.read','tax','View tax'),('tax.update','tax','Edit tax'),
    ('notification.read','system','View notifications'),('ai.use','ai','Use AI assistant'),
    ('report.read','reports','View reports');
  -- Grant all permissions to Admin
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT (SELECT id FROM roles WHERE name='Admin'), p.id FROM permissions p;

  -- Users (all share password Password123!)
  INSERT INTO users(firm_id, full_name, email, phone, password_hash, role, status) VALUES
    (v_firm,'Cassian Administrator','info@cassian.co.tz','+255 22 211 0001',pw,'Admin','active'),
    (v_firm,'CPA Emmanuel Cassian','emmanuel@cassian.co.tz','+255 754 100 200',pw,'Partner','active'),
    (v_firm,'CPA Grace Mhando','grace@cassian.co.tz','+255 754 100 201',pw,'Partner','active'),
    (v_firm,'Amani Mushi','amani@cassian.co.tz','+255 754 100 202',pw,'Manager','active'),
    (v_firm,'Neema Kessy','neema@cassian.co.tz','+255 754 100 203',pw,'Senior Auditor','active'),
    (v_firm,'Juma Ally','juma@cassian.co.tz','+255 754 100 204',pw,'Senior Auditor','active'),
    (v_firm,'Fatma Said','fatma@cassian.co.tz','+255 754 100 205',pw,'Accountant','active'),
    (v_firm,'David Mwakalinga','david@cassian.co.tz','+255 754 100 206',pw,'Tax Consultant','on_leave');
  SELECT id INTO v_admin FROM users WHERE email='info@cassian.co.tz';
  SELECT id INTO v_neema FROM users WHERE email='neema@cassian.co.tz';

  -- Clients (+ engagements & stages for Audit clients)
  FOR rec IN
    SELECT * FROM (VALUES
      ('Serengeti Breweries Ltd','Audit','109-876-543','40-012345-N','Manufacturing — Beverages','31 December','amani','emmanuel','Fieldwork','Fieldwork',35,38000000),
      ('Kilimanjaro Tours & Safaris Ltd','Audit','112-334-556','40-022118-K','Tourism & Hospitality','30 June','neema','grace','Partner Review','Partner Review',82,22000000),
      ('Tanzanite Mining Corp','Audit','118-223-009','40-090771-T','Mining','31 December','amani','emmanuel','Planning','Planning',12,54000000),
      ('Dodoma Cement PLC','Audit','105-667-220','40-033410-D','Manufacturing — Cement','31 December','neema','grace','Manager Review','Manager Review',68,61000000),
      ('Pwani Microfinance Ltd','Audit','121-009-883','40-051200-P','Financial Services','31 December','juma','emmanuel','Draft FR','Draft Financial Report',90,33000000),
      ('Mwanza Cotton Ginneries Ltd','Audit','108-119-664','40-028830-M','Manufacturing — Textiles','31 December','juma','emmanuel','Engagement Letter','Engagement Letter',8,28000000),
      ('Bahari Logistics Co. Ltd','Accounting','102-445-667','40-014559-B','Transport & Logistics','31 December','fatma','grace','Active — monthly','',0,4500000),
      ('Arusha Coffee Estates Ltd','Accounting','114-552-118','40-061907-A','Agriculture','30 June','fatma','grace','Active — monthly','',0,3800000),
      ('Zanzibar Spice Traders Ltd','Tax','126-778-540','40-077231-Z','Trading — Agro','31 December','david','emmanuel','ROI preparation','',0,9500000),
      ('Mbeya Agro Processors Ltd','Tax','117-664-201','40-044556-M','Agro-processing','31 December','david','grace','VAT review','',0,7200000),
      ('Tabora Honey Exporters Ltd','Accounting','129-551-338','40-066719-T','Export — Agriculture','30 June','fatma','grace','Active — monthly','',0,3200000),
      ('Selous Game Lodge Ltd','Consultancy','131-220-907','','Tourism & Hospitality','31 December','grace','emmanuel','Advisory — ongoing','',0,15000000)
    ) AS t(name,cat,tin,vrn,sector,fye,mgr,ptr,status,stage,prog,fee)
  LOOP
    INSERT INTO clients(firm_id,name,category,tin,vrn,sector,contact_name,contact_email,
        physical_address,financial_year_end,base_currency,engagement_partner_id,manager_id,status)
    VALUES (v_firm,rec.name,rec.cat,rec.tin,NULLIF(rec.vrn,''),rec.sector,'Finance Manager',
        'finance@'||regexp_replace(lower(rec.name),'[^a-z]','','g')||'.co.tz',
        'Dar es Salaam, Tanzania',rec.fye,'TZS',
        (SELECT id FROM users WHERE email=rec.ptr||'@cassian.co.tz'),
        (SELECT id FROM users WHERE email=rec.mgr||'@cassian.co.tz'), rec.status)
    RETURNING id INTO v_client;

    INSERT INTO user_client_access(user_id,client_id,access_level)
    VALUES ((SELECT id FROM users WHERE email=rec.mgr||'@cassian.co.tz'), v_client, 'owner');

    IF rec.cat='Audit' THEN
      INSERT INTO audit_engagements(firm_id,client_id,type,financial_year,period_start,period_end,
          partner_id,manager_id,status,current_stage,progress_pct,fee_amount,planned_start,target_completion)
      VALUES (v_firm,v_client,'Audit',2025,'2025-01-01','2025-12-31',
          (SELECT id FROM users WHERE email=rec.ptr||'@cassian.co.tz'),
          (SELECT id FROM users WHERE email=rec.mgr||'@cassian.co.tz'),
          'In progress',rec.stage,rec.prog,rec.fee,'2026-02-01','2026-06-30')
      RETURNING id INTO v_eng;

      ci := array_position(stages, rec.stage) - 1;     -- 0-based current index
      FOR i IN 1..array_length(stages,1) LOOP
        INSERT INTO audit_stages(engagement_id,sequence,name,status,progress_pct,responsible_user_id)
        VALUES (v_eng,i,stages[i],
          CASE WHEN i-1 < ci THEN 'completed' WHEN i-1 = ci THEN 'in_progress' ELSE 'not_started' END,
          CASE WHEN i-1 < ci THEN 100 WHEN i-1 = ci THEN rec.prog ELSE 0 END,
          (SELECT id FROM users WHERE email=rec.mgr||'@cassian.co.tz'));
      END LOOP;

      INSERT INTO audit_workflow_history(engagement_id,to_stage,action,changed_by)
      VALUES (v_eng,rec.stage,'seed',(SELECT id FROM users WHERE email=rec.mgr||'@cassian.co.tz'));
    END IF;
  END LOOP;

  -- Statutory deadlines for tax/accounting clients
  FOR rec IN SELECT id FROM clients WHERE firm_id=v_firm AND category IN ('Accounting','Tax') LOOP
    INSERT INTO statutory_deadlines(firm_id,client_id,type,authority,period,due_date,status,amount) VALUES
      (v_firm,rec.id,'PAYE','TRA','May 2026','2026-05-07','overdue',1500000),
      (v_firm,rec.id,'VAT','TRA','Apr 2026','2026-05-20','filed',2400000),
      (v_firm,rec.id,'PAYE','TRA','Jun 2026','2026-06-07','upcoming',1600000),
      (v_firm,rec.id,'SDL','TRA','Jun 2026','2026-06-07','upcoming',900000),
      (v_firm,rec.id,'VAT','TRA','May 2026','2026-06-20','upcoming',2500000),
      (v_firm,rec.id,'NSSF','NSSF','May 2026','2026-06-30','upcoming',3000000),
      (v_firm,rec.id,'WCF','WCF','May 2026','2026-06-30','upcoming',250000),
      (v_firm,rec.id,'ROI','TRA','FY2025','2026-06-30','upcoming',NULL),
      (v_firm,rec.id,'PDPC','PDPC','2026','2026-07-15','upcoming',NULL);
  END LOOP;

  -- Documents (metadata; full-text indexed for smart search)
  FOR rec IN SELECT id, name FROM clients
             WHERE name IN ('Serengeti Breweries Ltd','Dodoma Cement PLC','Pwani Microfinance Ltd') LOOP
    INSERT INTO documents(firm_id,client_id,storage,name,doc_type,year,mime_type,size_bytes,uploaded_by,ocr_text,ocr_status)
    SELECT v_firm, rec.id, 'local', d.label||' 2025.pdf', d.dt, 2025, 'application/pdf', 1048576, v_admin,
           rec.name||' '||d.label||' sample indexed text for smart search.', 'done'
    FROM (VALUES ('financial statements','financial_statements'),('bank statement','bank_statement'),
                 ('tax return','tax_return'),('payroll','payroll'),('invoice','invoice'),
                 ('engagement letter','engagement_letter')) AS d(label,dt);
  END LOOP;

  -- Tasks
  INSERT INTO tasks(firm_id,title,client_id,assignee_id,created_by,priority,status,due_date) VALUES
    (v_firm,'Complete revenue cut-off testing',(SELECT id FROM clients WHERE name='Serengeti Breweries Ltd'),v_neema,v_admin,'high','in_progress','2026-05-26 17:00:00+03'),
    (v_firm,'Clear PPE & deferred tax review points',(SELECT id FROM clients WHERE name='Dodoma Cement PLC'),v_neema,v_admin,'high','open','2026-05-27 17:00:00+03'),
    (v_firm,'Partner sign-off — Kilimanjaro Tours',(SELECT id FROM clients WHERE name='Kilimanjaro Tours & Safaris Ltd'),(SELECT id FROM users WHERE email='grace@cassian.co.tz'),v_admin,'urgent','open','2026-05-31 17:00:00+03'),
    (v_firm,'File PAYE (May) — overdue',(SELECT id FROM clients WHERE name='Mwanza Cotton Ginneries Ltd'),(SELECT id FROM users WHERE email='david@cassian.co.tz'),v_admin,'urgent','open','2026-05-07 17:00:00+03'),
    (v_firm,'Bank reconciliation — April',(SELECT id FROM clients WHERE name='Bahari Logistics Co. Ltd'),(SELECT id FROM users WHERE email='fatma@cassian.co.tz'),v_admin,'normal','done','2026-05-10 12:00:00+03');

  -- Notifications (for admin)
  INSERT INTO notifications(firm_id,user_id,type,title,body) VALUES
    (v_firm,v_admin,'warning','Overdue PAYE','PAYE (May 2026) is overdue for several clients — penalty risk.'),
    (v_firm,v_admin,'info','VAT batch due 20 Jun','VAT returns due on 20 June 2026.'),
    (v_firm,v_admin,'ai','AI anomaly detected','Revenue cut-off anomaly flagged for Serengeti Breweries.'),
    (v_firm,v_admin,'success','Review points cleared','Neema Kessy cleared 3 review points on Dodoma Cement PLC.');

  -- Calendar events
  INSERT INTO calendar_events(firm_id,title,type,start_at,all_day,color,created_by) VALUES
    (v_firm,'PAYE / SDL filing','tax','2026-06-07 09:00:00+03',1,'#b5800f',v_admin),
    (v_firm,'VAT returns batch','tax','2026-06-20 09:00:00+03',1,'#2c6fb3',v_admin),
    (v_firm,'NSSF & WCF contributions','tax','2026-06-30 09:00:00+03',1,'#2c6fb3',v_admin),
    (v_firm,'Income tax ROI deadline','tax','2026-06-30 09:00:00+03',1,'#2e7d57',v_admin);
END $$;

-- ============================================================
--  Accounting demo data (chart of accounts + posted journals)
--  Attached to one client so Trial Balance & Financial Statements
--  show real, balanced numbers out of the box.
-- ============================================================
DO $$
DECLARE
  v_firm uuid; v_admin uuid; v_client uuid; v_je uuid;
BEGIN
  SELECT id INTO v_firm  FROM firms LIMIT 1;
  SELECT id INTO v_admin FROM users WHERE email='info@cassian.co.tz';
  SELECT id INTO v_client FROM clients WHERE firm_id=v_firm AND name='Serengeti Breweries Ltd';
  IF v_client IS NULL THEN
    SELECT id INTO v_client FROM clients WHERE firm_id=v_firm ORDER BY name LIMIT 1;
  END IF;

  -- Chart of accounts
  INSERT INTO chart_of_accounts(firm_id,client_id,code,name,type) VALUES
    (v_firm,v_client,'1000','Cash and bank','asset'),
    (v_firm,v_client,'1100','Trade receivables','asset'),
    (v_firm,v_client,'1200','Inventory','asset'),
    (v_firm,v_client,'1500','Property, plant & equipment','asset'),
    (v_firm,v_client,'2000','Trade payables','liability'),
    (v_firm,v_client,'2100','VAT payable','liability'),
    (v_firm,v_client,'2200','Loans and borrowings','liability'),
    (v_firm,v_client,'3000','Share capital','equity'),
    (v_firm,v_client,'3100','Retained earnings','equity'),
    (v_firm,v_client,'4000','Sales revenue','income'),
    (v_firm,v_client,'4100','Other income','income'),
    (v_firm,v_client,'5000','Cost of sales','expense'),
    (v_firm,v_client,'6000','Operating expenses','expense'),
    (v_firm,v_client,'6100','Salaries and wages','expense'),
    (v_firm,v_client,'6200','Depreciation','expense');

  -- Helper inline: each block inserts a balanced, posted journal.
  -- JE-001 Share capital injection
  INSERT INTO journal_entries(firm_id,client_id,ref_no,entry_date,narration,currency,status,created_by,posted_by)
    VALUES (v_firm,v_client,'JE-001','2025-02-01','Share capital injection','TZS','posted',v_admin,v_admin) RETURNING id INTO v_je;
  INSERT INTO journal_lines(journal_id,account_id,description,debit,credit) VALUES
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='1000'),'Cash received',50000000,0),
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='3000'),'Shares issued',0,50000000);

  -- JE-002 Purchase of equipment
  INSERT INTO journal_entries(firm_id,client_id,ref_no,entry_date,narration,currency,status,created_by,posted_by)
    VALUES (v_firm,v_client,'JE-002','2025-02-10','Purchase of plant & equipment','TZS','posted',v_admin,v_admin) RETURNING id INTO v_je;
  INSERT INTO journal_lines(journal_id,account_id,description,debit,credit) VALUES
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='1500'),'Equipment',30000000,0),
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='1000'),'Cash paid',0,30000000);

  -- JE-003 Inventory purchase on credit
  INSERT INTO journal_entries(firm_id,client_id,ref_no,entry_date,narration,currency,status,created_by,posted_by)
    VALUES (v_firm,v_client,'JE-003','2025-03-05','Inventory purchased on credit','TZS','posted',v_admin,v_admin) RETURNING id INTO v_je;
  INSERT INTO journal_lines(journal_id,account_id,description,debit,credit) VALUES
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='1200'),'Stock',20000000,0),
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='2000'),'Supplier',0,20000000);

  -- JE-004 Sales (with 18% VAT)
  INSERT INTO journal_entries(firm_id,client_id,ref_no,entry_date,narration,currency,status,created_by,posted_by)
    VALUES (v_firm,v_client,'JE-004','2025-03-31','Sales for the quarter (VAT 18%)','TZS','posted',v_admin,v_admin) RETURNING id INTO v_je;
  INSERT INTO journal_lines(journal_id,account_id,description,debit,credit) VALUES
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='1000'),'Cash sales',23600000,0),
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='1100'),'Credit sales',11800000,0),
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='4000'),'Revenue',0,30000000),
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='2100'),'Output VAT',0,5400000);

  -- JE-005 Cost of sales
  INSERT INTO journal_entries(firm_id,client_id,ref_no,entry_date,narration,currency,status,created_by,posted_by)
    VALUES (v_firm,v_client,'JE-005','2025-03-31','Cost of goods sold','TZS','posted',v_admin,v_admin) RETURNING id INTO v_je;
  INSERT INTO journal_lines(journal_id,account_id,description,debit,credit) VALUES
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='5000'),'COGS',18000000,0),
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='1200'),'Stock released',0,18000000);

  -- JE-006 Salaries
  INSERT INTO journal_entries(firm_id,client_id,ref_no,entry_date,narration,currency,status,created_by,posted_by)
    VALUES (v_firm,v_client,'JE-006','2025-04-05','Payroll — April','TZS','posted',v_admin,v_admin) RETURNING id INTO v_je;
  INSERT INTO journal_lines(journal_id,account_id,description,debit,credit) VALUES
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='6100'),'Salaries',6000000,0),
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='1000'),'Net pay',0,6000000);

  -- JE-007 Operating expenses
  INSERT INTO journal_entries(firm_id,client_id,ref_no,entry_date,narration,currency,status,created_by,posted_by)
    VALUES (v_firm,v_client,'JE-007','2025-04-10','Operating expenses','TZS','posted',v_admin,v_admin) RETURNING id INTO v_je;
  INSERT INTO journal_lines(journal_id,account_id,description,debit,credit) VALUES
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='6000'),'Overheads',3500000,0),
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='1000'),'Cash paid',0,3500000);

  -- JE-008 Depreciation
  INSERT INTO journal_entries(firm_id,client_id,ref_no,entry_date,narration,currency,status,created_by,posted_by)
    VALUES (v_firm,v_client,'JE-008','2025-04-30','Depreciation charge','TZS','posted',v_admin,v_admin) RETURNING id INTO v_je;
  INSERT INTO journal_lines(journal_id,account_id,description,debit,credit) VALUES
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='6200'),'Depreciation',2500000,0),
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='1500'),'Accumulated depreciation',0,2500000);

  -- JE-009 Other income
  INSERT INTO journal_entries(firm_id,client_id,ref_no,entry_date,narration,currency,status,created_by,posted_by)
    VALUES (v_firm,v_client,'JE-009','2025-05-02','Sundry income','TZS','posted',v_admin,v_admin) RETURNING id INTO v_je;
  INSERT INTO journal_lines(journal_id,account_id,description,debit,credit) VALUES
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='1000'),'Cash',1200000,0),
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='4100'),'Other income',0,1200000);

  -- JE-010 Loan received
  INSERT INTO journal_entries(firm_id,client_id,ref_no,entry_date,narration,currency,status,created_by,posted_by)
    VALUES (v_firm,v_client,'JE-010','2025-05-15','Bank loan drawdown','TZS','posted',v_admin,v_admin) RETURNING id INTO v_je;
  INSERT INTO journal_lines(journal_id,account_id,description,debit,credit) VALUES
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='1000'),'Cash',10000000,0),
    (v_je,(SELECT id FROM chart_of_accounts WHERE client_id=v_client AND code='2200'),'Loan',0,10000000);
END $$;
